import { google } from "googleapis";
import { getAppConfig } from "./config.js";
import { getRefreshToken, saveRefreshToken } from "./token-store.js";
import logger from "./logger.js";

let gmailClient = null;
let oauth2ClientRef = null;

/**
 * Reset the Gmail client singleton so the next call to getGmailClient()
 * creates a fresh one. Call this on auth failures.
 */
export function resetGmailClient() {
    gmailClient = null;
    oauth2ClientRef = null;
    logger.debug("[GMAIL] Client reset — will re-create on next use");
}

/**
 * Get authenticated Gmail API client (singleton).
 * Reads the refresh token from the persistent token store (data/google-tokens.json)
 * and listens for token rotation events to auto-persist new tokens.
 */
export async function getGmailClient() {
    if (gmailClient) return gmailClient;

    const config = getAppConfig();
    const refreshToken = await getRefreshToken();

    if (!refreshToken) {
        throw new Error("IMAP not configured. Run `node tools/get-token.js` first.");
    }

    const oauth2Client = new google.auth.OAuth2(
        config.googleClientId,
        config.googleClientSecret
    );

    oauth2Client.setCredentials({
        refresh_token: refreshToken,
    });

    // When Google rotates the refresh token, persist the new one automatically
    oauth2Client.on("tokens", async (tokens) => {
        logger.debug("[GMAIL] Received new tokens from Google (access_token refreshed)");
        if (tokens.refresh_token) {
            logger.debug("[GMAIL] Google issued a NEW refresh token — saving to disk");
            await saveRefreshToken(tokens.refresh_token);
        }
    });

    // Proactively force an access token refresh now so we detect stale
    // refresh tokens immediately (instead of failing silently on the first API call).
    try {
        const { credentials } = await oauth2Client.refreshAccessToken();
        oauth2Client.setCredentials(credentials);
        if (credentials.refresh_token) {
            await saveRefreshToken(credentials.refresh_token);
        }
        logger.debug("[GMAIL] Access token refreshed successfully");
    } catch (err) {
        const msg = err?.message || "";
        if (msg.includes("invalid_grant") || msg.includes("Token has been expired or revoked")) {
            logger.error(
                "[GMAIL] ❌ Refresh token is EXPIRED or REVOKED. " +
                "Re-run `node tools/get-token.js` to get a new one. " +
                "If this keeps happening weekly, move your Google Cloud OAuth app " +
                "from 'Testing' to 'Production' publishing status."
            );
        }
        throw err;
    }

    oauth2ClientRef = oauth2Client;
    gmailClient = google.gmail({ version: "v1", auth: oauth2Client });
    return gmailClient;
}

/**
 * Check if the current auth error is a token/auth problem
 */
export function isAuthError(error) {
    const msg = (error?.message || "").toLowerCase();
    const code = error?.code || error?.response?.status;
    return (
        code === 401 ||
        code === 403 ||
        msg.includes("invalid_grant") ||
        msg.includes("token has been expired") ||
        msg.includes("token has been revoked") ||
        msg.includes("unauthorized") ||
        msg.includes("invalid credentials")
    );
}

/**
 * Test Gmail API connection — verifies OAuth credentials work
 */
export async function testGmailConnection() {
    const config = getAppConfig();
    const refreshToken = await getRefreshToken();

    if (!config.googleClientId || !config.googleClientSecret || !refreshToken) {
        return {
            success: false,
            message: "Google OAuth credentials not configured in .env",
        };
    }

    try {
        const gmail = await getGmailClient();
        const profile = await gmail.users.getProfile({ userId: "me" });
        return {
            success: true,
            message: `Gmail connected as ${profile.data.emailAddress}`,
        };
    } catch (error) {
        // Reset client on auth failure so it can be recreated with fresh token
        resetGmailClient();
        return {
            success: false,
            message: `Gmail API error: ${error.message}`,
        };
    }
}

/**
 * Sets up a Gmail watch for push notifications.
 */
export async function setupGmailWatch() {
    const config = getAppConfig();
    if (!config.googlePubSubTopic) {
        throw new Error("GOOGLE_PUBSUB_TOPIC not configured. Webhooks are disabled.");
    }

    const gmail = await getGmailClient();
    const res = await gmail.users.watch({
        userId: "me",
        requestBody: {
            topicName: config.googlePubSubTopic,
            labelIds: ["INBOX"],
        },
    });

    return res.data;
}
