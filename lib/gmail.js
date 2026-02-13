import { google } from "googleapis";
import { getAppConfig } from "./config.js";

let gmailClient = null;

/**
 * Get authenticated Gmail API client (singleton)
 */
export function getGmailClient() {
    if (gmailClient) return gmailClient;

    const config = getAppConfig();
    const oauth2Client = new google.auth.OAuth2(
        config.googleClientId,
        config.googleClientSecret
    );

    oauth2Client.setCredentials({
        refresh_token: config.googleRefreshToken,
    });

    gmailClient = google.gmail({ version: "v1", auth: oauth2Client });
    return gmailClient;
}

/**
 * Test Gmail API connection — verifies OAuth credentials work
 */
export async function testGmailConnection() {
    const config = getAppConfig();

    if (!config.googleClientId || !config.googleClientSecret || !config.googleRefreshToken) {
        return {
            success: false,
            message: "Google OAuth credentials not configured in .env",
        };
    }

    try {
        const gmail = getGmailClient();
        const profile = await gmail.users.getProfile({ userId: "me" });
        return {
            success: true,
            message: `Gmail connected as ${profile.data.emailAddress}`,
        };
    } catch (error) {
        // Reset client on auth failure so it can be recreated
        gmailClient = null;
        return {
            success: false,
            message: `Gmail API error: ${error.message}`,
        };
    }
}
