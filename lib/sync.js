import { getGmailClient } from "./gmail.js";
import { getAppConfig } from "./config.js";
import { prisma } from "./db.js";
import logger from "./logger.js";

// ── Configuration ──
const SYNC_INTERVAL_MS = 10000; // 10 seconds

// Regex for verification codes:
// - 6 digits (e.g., 123456)
// - OR alphanumeric 5-5 format with at least 4 digits total (e.g., A1B2C-D3E4F)
const CODE_REGEX = /\b(?<!\.)(\d{6}|(?=(?:[A-Za-z0-9]*\d){4})[A-Za-z0-9]{5}-[A-Za-z0-9]{5})(?!\.)\b/gi;

// ── Singleton State ──
let syncLoopRunning = false;
let syncInProgress = false;
let lastSyncStart = 0;
let lastHistoryId = null; // For incremental Gmail sync

/**
 * Extract verification codes from text
 */
function extractCodes(text) {
    if (!text) return [];
    const matches = text.match(CODE_REGEX);
    return matches ? Array.from(new Set(matches)) : [];
}

/**
 * Decode a base64url-encoded string (Gmail API format)
 */
function decodeBase64Url(data) {
    if (!data) return "";
    return Buffer.from(data, "base64url").toString("utf-8");
}

/**
 * Extract text content from Gmail API message parts (recursive)
 */
function extractTextFromParts(parts) {
    let text = "";
    let html = "";

    if (!parts) return { text, html };

    for (const part of parts) {
        const mimeType = part.mimeType || "";

        if (mimeType === "text/plain" && part.body?.data) {
            text += decodeBase64Url(part.body.data);
        } else if (mimeType === "text/html" && part.body?.data) {
            html += decodeBase64Url(part.body.data);
        }

        // Recurse into nested parts (multipart/*)
        if (part.parts) {
            const nested = extractTextFromParts(part.parts);
            text += nested.text;
            html += nested.html;
        }
    }

    return { text, html };
}

/**
 * Extract email address from Gmail header value
 * Handles formats like: "Name <email@example.com>" or "email@example.com"
 */
function extractEmailAddress(headerValue) {
    if (!headerValue) return null;
    const match = headerValue.match(/<([^>]+)>/);
    return match ? match[1].toLowerCase() : headerValue.trim().toLowerCase();
}

/**
 * Perform a single sync operation
 */
async function syncOnce() {
    // Stuck detection: if sync has been "in progress" for > 2 minutes, force reset
    if (syncInProgress) {
        if (Date.now() - lastSyncStart > 120000) {
            logger.warn("[SYNC] ⚠️ Sync appears stuck (started >2m ago). Forcing reset.");
            syncInProgress = false;
        } else {
            logger.debug("[SYNC] ⏭️ Skipping - sync already in progress");
            return;
        }
    }

    syncInProgress = true;
    lastSyncStart = Date.now();
    const config = getAppConfig();

    try {
        const gmail = getGmailClient();

        // Calculate search window
        const lookbackMinutes = config.lookbackMinutes || 8;
        const afterEpoch = Math.floor((Date.now() - lookbackMinutes * 60 * 1000) / 1000);

        // Search for recent messages
        const query = `after:${afterEpoch}`;
        logger.info(`[SYNC] Searching Gmail: q="${query}"`);

        let allMessageIds = [];
        let pageToken = undefined;

        // Paginate through results
        do {
            const listResult = await gmail.users.messages.list({
                userId: "me",
                q: query,
                maxResults: 100,
                pageToken,
            });

            if (listResult.data.messages) {
                allMessageIds.push(...listResult.data.messages.map(m => m.id));
            }
            pageToken = listResult.data.nextPageToken;
        } while (pageToken);

        if (!allMessageIds.length) {
            logger.info("[SYNC] No messages found in lookback window.");
            return;
        }

        logger.info(`[SYNC] 📧 Found ${allMessageIds.length} message(s) in window`);

        // Fetch each message and extract codes
        const newCodes = [];

        for (const msgId of allMessageIds) {
            try {
                const msg = await gmail.users.messages.get({
                    userId: "me",
                    id: msgId,
                    format: "full",
                });

                const headers = msg.data.payload?.headers || [];
                const getHeader = (name) =>
                    headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || null;

                const subject = getHeader("Subject") || "(no subject)";
                const from = extractEmailAddress(getHeader("From"));
                const to = extractEmailAddress(getHeader("To"));
                const dateHeader = getHeader("Date");
                const receivedAt = dateHeader ? new Date(dateHeader) : new Date(Number(msg.data.internalDate));

                logger.info({
                    msgId,
                    from,
                    to,
                    subject,
                    date: receivedAt,
                }, `[SYNC] Processing: "${subject}" from ${from}`);

                // Extract text content from message parts
                let textContent = "";
                let htmlContent = "";

                if (msg.data.payload?.body?.data) {
                    // Simple message (no parts)
                    const decoded = decodeBase64Url(msg.data.payload.body.data);
                    if (msg.data.payload.mimeType === "text/html") {
                        htmlContent = decoded;
                    } else {
                        textContent = decoded;
                    }
                }

                if (msg.data.payload?.parts) {
                    const extracted = extractTextFromParts(msg.data.payload.parts);
                    textContent += extracted.text;
                    htmlContent += extracted.html;
                }

                const fullText = textContent + " " + htmlContent;
                const codes = extractCodes(fullText);

                if (codes.length > 0) {
                    logger.info({ codes }, `[SYNC] Found ${codes.length} code(s) in "${subject}"`);

                    const isProtected =
                        fullText.includes("reset code") ||
                        fullText.includes("password reset") ||
                        htmlContent.includes("background-color: #f3f3f3");

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
                } else {
                    logger.debug(`[SYNC] No codes in "${subject}"`);
                }
            } catch (msgError) {
                logger.error({ err: msgError, msgId }, `[SYNC] Error fetching message ${msgId}`);
            }
        }

        if (newCodes.length === 0) {
            logger.info("[SYNC] No valid codes extracted.");
            return;
        }

        // Batch deduplication against DB
        const CHUNK_SIZE = 100;
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
                select: { code: true, email: true, receivedAt: true },
            });

            existingCodes.forEach((c) => {
                existingSet.add(`${c.code}|${c.email}|${c.receivedAt.getTime()}`);
            });
        }

        const codesToInsert = newCodes.filter((c) => {
            const key = `${c.code}|${c.email}|${c.receivedAt.getTime()}`;
            return !existingSet.has(key);
        });

        if (codesToInsert.length === 0) {
            logger.info("[SYNC] ✅ No new unique codes (all duplicates)");
            return;
        }

        await prisma.code.createMany({ data: codesToInsert });
        logger.info({ count: codesToInsert.length }, `[SYNC] ✅ Saved ${codesToInsert.length} new code(s)`);

    } catch (error) {
        logger.error({ err: error }, "[SYNC] Error during sync cycle");
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
    logger.info("[SYNC] 🔄 Starting background sync loop (Gmail API)");

    // Run first sync immediately
    syncOnce().catch((err) => logger.error({ err }, "[SYNC] Initial sync error"));

    // Then repeat on interval
    setInterval(() => {
        syncOnce().catch((err) => logger.error({ err }, "[SYNC] Interval sync error"));
    }, SYNC_INTERVAL_MS);
}

/**
 * Legacy export for compatibility
 */
export async function syncEmails() {
    startSyncLoop();
}
