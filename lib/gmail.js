import { google } from "googleapis";
import { getAppConfig } from "./config.js";
import { getRefreshToken, saveRefreshToken } from "./token-store.js";
import logger from "./logger.js";

let gmailClient = null;

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
        throw new Error("No refresh token available. Run `node tools/get-token.js` first.");
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
        if (tokens.refresh_token) {
            logger.info("[GMAIL] Google issued a new refresh token — saving to disk");
            await saveRefreshToken(tokens.refresh_token);
        }
    });

    gmailClient = google.gmail({ version: "v1", auth: oauth2Client });
    return gmailClient;
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
        gmailClient = null;
        return {
            success: false,
            message: `Gmail API error: ${error.message}`,
        };
    }
}
