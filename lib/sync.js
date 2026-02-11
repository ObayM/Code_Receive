import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "./db.js";
import { getImapConfig } from "./imap.js";
import logger from "./logger.js";

// ── Configuration ──
const SYNC_INTERVAL_MS = 10000; // 10 seconds
// Regex for verification codes: 
// - 6 digits (e.g., 123456)
// - OR alphanumeric 5-5 format with at least 4 digits total (e.g., A1B2C-D3E4F)
const CODE_REGEX = /\b(?<!\.)(\d{6}|(?=(?:[A-Za-z0-9]*\d){4})[A-Za-z0-9]{5}-[A-Za-z0-9]{5})(?!\.)\b/gi;


// ── Singleton State ──
let imapClient = null;
let syncLoopRunning = false;
let syncInProgress = false;

/**
 * Extract verification codes from text
 */
function extractCodes(text) {
    if (!text) return [];
    const matches = text.match(CODE_REGEX);
    return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Normalize email address from IMAP envelope
 */
function normalizeAddress(addr) {
    if (!addr) return null;
    if (Array.isArray(addr)) return normalizeAddress(addr[0]);
    return addr.address || addr.name || null;
}

/**
 * Get or create persistent IMAP connection
 */
async function getImapClient() {
    const config = getImapConfig();

    // If we have a client and it's usable, return it
    if (imapClient?.usable) {
        return imapClient;
    }

    // Close stale client if exists
    if (imapClient) {
        try {
            await imapClient.logout();
        } catch { }
        imapClient = null;
    }

    // Create new connection
    const client = new ImapFlow({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: {
            user: config.user,
            pass: config.password,
        },
        logger: false,
    });

    // Reconnect on close
    client.on("close", () => {
        logger.info("[SYNC] IMAP connection closed");
        imapClient = null;
    });

    client.on("error", (err) => {
        logger.error({ err }, "[SYNC] IMAP error");
        imapClient = null;
    });

    await client.connect();
    await client.mailboxOpen(config.mailboxName);

    imapClient = client;
    logger.info(`[SYNC] ✅ Connected to ${config.host}`);
    return client;
}

/**
 * Perform a single sync operation
 */
async function syncOnce() {
    if (syncInProgress) {
        logger.info("[SYNC] ⏭️  Skipping - sync already in progress");
        return;
    }

    syncInProgress = true;
    const config = getImapConfig();

    try {
        const client = await getImapClient();

        // Get the latest receivedAt to optimize fetch
        const lastCode = await prisma.code.findFirst({
            orderBy: { receivedAt: "desc" },
        });

        // Calculate search window
        const lookbackMinutes = config.lookbackMinutes || 5;
        const defaultStart = new Date(Date.now() - lookbackMinutes * 60 * 1000);
        const searchSince = lastCode
            ? new Date(lastCode.receivedAt.getTime() - 60 * 1000) // 1 min overlap for safety
            : defaultStart;

        // Search for emails
        const messages = await client.search({
            since: searchSince,
        });

        if (!messages.length) {
            return;
        }

        logger.info(`[SYNC] 📧 Found ${messages.length} emails to process`);

        // Collect all codes from all messages
        const newCodes = [];

        for await (const message of client.fetch(messages, {
            envelope: true,
            source: true,
            internalDate: true,
        })) {
            const receivedAt = message.envelope.date || message.internalDate;
            const parsed = await simpleParser(message.source);

            const from = normalizeAddress(message.envelope.from);
            const to = normalizeAddress(message.envelope.to);
            const subject = message.envelope.subject;

            const text = (parsed.text || "") + " " + (parsed.html || "");
            const codes = extractCodes(text);

            if (codes.length > 0) {
                // Check for "protected" keywords
                const isProtected =
                    text.includes("reset code") ||
                    text.includes("password reset") ||
                    (parsed.html && parsed.html.includes("background-color: #f3f3f3"));

                for (const code of codes) {
                    newCodes.push({
                        code,
                        email: to || "unknown",
                        from: from,
                        subject: subject,
                        receivedAt,
                        isProtected: !!isProtected,
                    });
                }
            }
        }

        if (newCodes.length === 0) {
            return;
        }

        // Batch deduplication: fetch existing codes in chunks to avoid SQLite parameter limit
        const CHUNK_SIZE = 100; // SQLite limit is 999 params, each OR entry uses 3 params
        const existingSet = new Set();

        for (let i = 0; i < newCodes.length; i += CHUNK_SIZE) {
            const chunk = newCodes.slice(i, i + CHUNK_SIZE);
            const existingCodes = await prisma.code.findMany({
                where: {
                    OR: chunk.map((c) => ({
                        code: c.code,
                        email: c.email,
                        receivedAt: c.receivedAt,
                    })),
                },
                select: {
                    code: true,
                    email: true,
                    receivedAt: true,
                },
            });

            // Add to set
            existingCodes.forEach((c) => {
                existingSet.add(`${c.code}|${c.email}|${c.receivedAt.getTime()}`);
            });
        }

        // Filter out already-existing codes
        const codesToInsert = newCodes.filter((c) => {
            const key = `${c.code}|${c.email}|${c.receivedAt.getTime()}`;
            return !existingSet.has(key);
        });

        if (codesToInsert.length === 0) {
            logger.info("[SYNC] ✅ No new codes (all duplicates)");
            return;
        }

        // Insert in one batch
        await prisma.code.createMany({
            data: codesToInsert,
        });



        logger.info(`[SYNC] ✅ Saved ${codesToInsert.length} new code(s)`);
    } catch (error) {
        logger.error({ err: error }, "[SYNC] Error");
        // On error, clear client so next sync reconnects
        if (imapClient) {
            try {
                await imapClient.logout();
            } catch { }
            imapClient = null;
        }
    } finally {
        syncInProgress = false;
    }
}

/**
 * Start the background sync loop (idempotent - safe to call multiple times)
 */
export function startSyncLoop() {
    if (syncLoopRunning) {
        return; // Already running
    }

    syncLoopRunning = true;
    logger.info("[SYNC] 🔄 Starting background sync loop");

    // Run first sync immediately
    syncOnce().catch((err) => logger.error({ err }, "[SYNC] Initial sync error"));

    // Then repeat on interval
    setInterval(() => {
        syncOnce().catch((err) => logger.error({ err }, "[SYNC] Interval sync error"));
    }, SYNC_INTERVAL_MS);
}

/**
 * Legacy export for compatibility (now just triggers the background loop)
 */
export async function syncEmails() {
    startSyncLoop();
    // Don't await - just ensure the loop is running
}
