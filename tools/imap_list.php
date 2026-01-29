<?php
declare(strict_types=1);

$root = dirname(__DIR__);
$envPath = $root . "/.env";
if (!is_file($envPath)) {
    fwrite(STDERR, "Missing .env\n");
    exit(1);
}

foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
    $line = trim($line);
    if ($line === "" || str_starts_with($line, "#")) {
        continue;
    }
    $parts = explode("=", $line, 2);
    if (count($parts) === 2) {
        putenv(trim($parts[0]) . "=" . trim($parts[1]));
    }
}

$host = getenv("IMAP_HOST") ?: "imap.gmail.com";
$port = getenv("IMAP_PORT") ?: "993";
$encryption = getenv("IMAP_ENCRYPTION") ?: "ssl";
$user = getenv("IMAP_USER") ?: "";
$pass = getenv("IMAP_PASSWORD") ?: "";

$mailbox = "{" . $host . ":" . $port . "/imap/" . $encryption . "}";
$imap = @imap_open($mailbox, $user, $pass);
if (!$imap) {
    fwrite(STDERR, "IMAP_OPEN_FAILED\n");
    exit(1);
}

$boxes = imap_list($imap, $mailbox, "*") ?: [];
foreach ($boxes as $box) {
    echo $box . PHP_EOL;
}
imap_close($imap);
