<?php
declare(strict_types=1);

$publicDir = __DIR__;
$rootDir = dirname(__DIR__);

if (php_sapi_name() === "cli-server") {
    $path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH);
    $file = $publicDir . $path;
    if (is_file($file)) {
        return false;
    }
}

loadEnv($rootDir . "/.env");

$imapHost = getenv("IMAP_HOST") ?: "imap.gmail.com";
$imapPort = getenv("IMAP_PORT") ?: "993";
$imapEncryption = getenv("IMAP_ENCRYPTION") ?: "ssl";
$imapUser = getenv("IMAP_USER") ?: "";
$imapPassword = getenv("IMAP_PASSWORD") ?: "";
$lookbackMinutes = (int)(getenv("LOOKBACK_MINUTES") ?: 500);
$lockPasswords = parsePasswordList(getenv("LOCK_PASSWORDS") ?: "");
$authorizedInbox = strtolower(trim(getenv("AUTHORIZED_INBOX") ?: ""));
$allowedDomains = parseDomainList(getenv("ALLOWED_DOMAINS") ?: "");
$imapMailboxName = getenv("IMAP_MAILBOX") ?: (stripos($imapHost, "gmail.com") !== false ? "[Gmail]/All Mail" : "INBOX");
$imapMailbox = buildMailbox($imapHost, $imapPort, $imapEncryption, $imapMailboxName);

$path = parse_url($_SERVER["REQUEST_URI"], PHP_URL_PATH) ?: "/";

switch ($path) {
    case "/":
        renderHome();
        break;
    case "/api/auth/status":
        handleAuthStatus($imapMailbox, $imapUser, $imapPassword, $authorizedInbox);
        break;
    case "/api/codes":
        handleCodes(
            $imapMailbox,
            $imapUser,
            $imapPassword,
            $authorizedInbox,
            $allowedDomains,
            $lookbackMinutes,
            $lockPasswords
        );
        break;
    default:
        http_response_code(404);
        echo "Not found";
}

function renderHome(): void
{
    $html = file_get_contents(__DIR__ . "/templates/home.html");
    echo $html;
}

function handleAuthStatus(string $mailbox, string $user, string $password, string $authorizedInbox): void
{
    if (!extension_loaded("imap")) {
        http_response_code(500);
        respondJson([
            "authenticated" => false,
            "message" => "PHP IMAP extension is not enabled."
        ]);
        return;
    }
    if ($user === "" || $password === "") {
        respondJson([
            "authenticated" => false,
            "message" => "Missing IMAP credentials in .env."
        ]);
        return;
    }
    if ($authorizedInbox !== "" && strtolower($user) !== $authorizedInbox) {
        respondJson([
            "authenticated" => false,
            "message" => "IMAP user must match the authorized inbox."
        ]);
        return;
    }
    $imap = @imap_open($mailbox, $user, $password);
    if ($imap === false) {
        $errorText = trim(implode("; ", imap_errors() ?: []));
        $message = $errorText !== "" ? $errorText : "IMAP login failed. Check IMAP_USER, IMAP_PASSWORD, and IMAP_MAILBOX.";
        respondJson([
            "authenticated" => false,
            "message" => $message
        ]);
        return;
    }
    imap_close($imap);
    respondJson(["authenticated" => true, "message" => "IMAP connected. Ready to search."]);
}

function handleCodes(
    string $mailbox,
    string $user,
    string $password,
    string $authorizedInbox,
    array $allowedDomains,
    int $lookbackMinutes,
    array $lockPasswords
): void
{
    $email = strtolower(trim($_GET["email"] ?? ""));
    $unlockPassword = trim((string)($_GET["password"] ?? ""));
    if ($email === "" || strpos($email, "@") === false) {
        http_response_code(400);
        respondJson(["error" => "Please provide a valid email address."]);
        return;
    }
    if (!isAllowedEmail($email, $allowedDomains)) {
        http_response_code(403);
        respondJson(["error" => "Email domain is not allowed."]);
        return;
    }
    if (!extension_loaded("imap")) {
        http_response_code(500);
        respondJson(["error" => "PHP IMAP extension is not enabled."]);
        return;
    }
    if ($user === "" || $password === "") {
        http_response_code(401);
        respondJson(["error" => "Missing IMAP credentials."]);
        return;
    }
    if ($authorizedInbox !== "" && strtolower($user) !== $authorizedInbox) {
        http_response_code(403);
        respondJson(["error" => "Authorized inbox must be {$authorizedInbox}."]);
        return;
    }

    $imap = @imap_open($mailbox, $user, $password);
    if ($imap === false) {
        http_response_code(401);
        respondJson(["error" => "IMAP login failed. Check IMAP_USER, IMAP_PASSWORD, and IMAP_MAILBOX."]);
        return;
    }

    $items = [];
    $lockedItems = [];
    // Bypass lock system: always treat as unlocked.
    $unlocked = true;
    $safeLookback = max(1, $lookbackMinutes);
    $now = new DateTimeImmutable("now");
    $cutoff = $now->sub(new DateInterval("PT" . ($safeLookback * 60) . "S"));
    $sinceDate = $cutoff->format("d-M-Y");
    $search = "TO \"" . addcslashes($email, "\"") . "\" SINCE \"" . $sinceDate . "\"";
    $ids = imap_search($imap, $search) ?: [];

    foreach ($ids as $id) {
        $overview = imap_fetch_overview($imap, (string)$id, 0);
        $dateValue = $overview[0]->date ?? "";
        if ($dateValue === "") {
            continue;
        }
        try {
            $messageTime = new DateTimeImmutable($dateValue);
        } catch (Exception $e) {
            continue;
        }
        if ($messageTime < $cutoff) {
            continue;
        }
        $from = normalizeFrom($overview[0]->from ?? "");
        $content = fetchMessageContent($imap, (int)$id);
        $codesFound = extractCodes($content["text"]);
        if (!$codesFound) {
            continue;
        }
        $containsResetCode = str_contains(strtolower($content["text"]), "reset code");
        $hasGrayBackground = $content["html"] !== "" && preg_match("/background-color:\\s*#f3f3f3/i", $content["html"]);
        $isLocked = $containsResetCode || $hasGrayBackground;

        foreach ($codesFound as $code) {
            $entry = [
                "code" => $code,
                "from" => $from,
                "timestamp" => $messageTime->getTimestamp(),
                "time" => $messageTime->format(DateTimeInterface::ATOM)
            ];
            if ($isLocked && !$unlocked) {
                $lockedItems[] = $entry;
                continue;
            }
            $items[] = $entry;
        }
    }

    $items = sortItemsByTime($items);
    $lockedItems = sortItemsByTime($lockedItems);
    $lockedCount = $unlocked ? 0 : count($lockedItems);

    imap_close($imap);
    respondJson([
        "email" => $email,
        "items" => $items,
        "lockedItems" => $unlocked ? $lockedItems : [],
        "lockedCount" => $lockedCount,
        "unlocked" => $unlocked,
        "checkedAt" => gmdate("c")
    ]);
}

function extractCodes(string $text): array
{
    if ($text === "") {
        return [];
    }
    preg_match_all("/\\b(\\d{6}|[A-Za-z0-9]{5}-[A-Za-z0-9]{5})\\b/", $text, $matches);
    return array_unique($matches[0] ?? []);
}

function fetchMessageContent($imap, int $id): array
{
    $structure = imap_fetchstructure($imap, $id);
    $textParts = [];
    $htmlParts = [];
    if (!$structure || empty($structure->parts)) {
        $body = imap_body($imap, $id, FT_PEEK);
        $encoding = $structure ? (int)$structure->encoding : 0;
        $isHtml = $structure && strtoupper((string)($structure->subtype ?? "")) === "HTML";
        $decoded = decodeBody($body, $encoding);
        if ($isHtml) {
            $htmlParts[] = $decoded;
            $textParts[] = strip_tags($decoded);
        } else {
            $textParts[] = $decoded;
        }
        return [
            "text" => trim(implode("\n", array_filter($textParts))),
            "html" => trim(implode("\n", array_filter($htmlParts)))
        ];
    }

    collectImapParts($imap, $id, $structure, "", $textParts, $htmlParts);
    return [
        "text" => trim(implode("\n", array_filter($textParts))),
        "html" => trim(implode("\n", array_filter($htmlParts)))
    ];
}

function collectImapParts($imap, int $id, $structure, string $prefix, array &$texts, array &$htmlParts): void
{
    if (empty($structure->parts)) {
        return;
    }
    foreach ($structure->parts as $index => $part) {
        $partNumber = $prefix === "" ? (string)($index + 1) : $prefix . "." . ($index + 1);
        if ($part->type === 0) {
            $body = imap_fetchbody($imap, $id, $partNumber, FT_PEEK);
            $isHtml = strtoupper($part->subtype ?? "") === "HTML";
            $decoded = decodeBody($body, (int)($part->encoding ?? 0));
            if ($isHtml) {
                $htmlParts[] = $decoded;
                $texts[] = strip_tags($decoded);
            } else {
                $texts[] = $decoded;
            }
        }
        if (!empty($part->parts)) {
            collectImapParts($imap, $id, $part, $partNumber, $texts, $htmlParts);
        }
    }
}

function decodeBody(string $body, int $encoding): string
{
    $text = $body;
    if ($encoding === 3) {
        $text = imap_base64($text);
    } elseif ($encoding === 4) {
        $text = imap_qprint($text);
    }
    return $text;
}

function normalizeFrom(string $raw): string
{
    $value = trim(imap_utf8($raw));
    return $value === "" ? "Unknown sender" : $value;
}

function sortItemsByTime(array $items): array
{
    usort($items, function (array $a, array $b) {
        return ($b["timestamp"] ?? 0) <=> ($a["timestamp"] ?? 0);
    });
    return $items;
}

function buildMailbox(string $host, string $port, string $encryption, string $mailboxName): string
{
    $flags = "/imap";
    if ($encryption !== "") {
        $flags .= "/" . $encryption;
    }
    return "{" . $host . ":" . $port . $flags . "}" . $mailboxName;
}

function parseDomainList(string $value): array
{
    if ($value === "") {
        return [];
    }
    $parts = array_map("trim", explode(",", strtolower($value)));
    return array_filter($parts, fn($domain) => $domain !== "");
}

function isAllowedEmail(string $email, array $allowedDomains): bool
{
    if (!$allowedDomains) {
        return true;
    }
    $parts = explode("@", $email);
    $domain = strtolower($parts[1] ?? "");
    return $domain !== "" && in_array($domain, $allowedDomains, true);
}

function parsePasswordList(string $value): array
{
    if ($value === "") {
        return [];
    }
    $parts = array_map("trim", explode(",", $value));
    return array_filter($parts, fn($item) => $item !== "");
}

function isPasswordValid(string $password, array $allowedPasswords): bool
{
    if ($password === "" || !$allowedPasswords) {
        return false;
    }
    return in_array($password, $allowedPasswords, true);
}

function loadEnv(string $path): void
{
    if (!is_file($path)) {
        return;
    }
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines ?: [] as $line) {
        $line = trim($line);
        if ($line === "" || str_starts_with($line, "#")) {
            continue;
        }
        $parts = explode("=", $line, 2);
        if (count($parts) !== 2) {
            continue;
        }
        $key = trim($parts[0]);
        $value = trim($parts[1]);
        if ($key === "") {
            continue;
        }
        putenv($key . "=" . $value);
    }
}

function respondJson(array $data): void
{
    header("Content-Type: application/json");
    echo json_encode($data);
}
