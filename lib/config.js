/**
 * Get application configuration from environment variables
 * (Replaces the old IMAP-only config)
 */
export function getAppConfig() {
    const lookbackMinutes = Number(process.env.LOOKBACK_MINUTES || "8");
    const authorizedInbox = (process.env.AUTHORIZED_INBOX || "").trim().toLowerCase();

    const allowedDomains = (process.env.ALLOWED_DOMAINS || "")
        .split(",")
        .map(d => d.trim().toLowerCase())
        .filter(Boolean);

    const adminPasswords = (process.env.ADMIN_PASSWORDS || "")
        .split(",")
        .map(p => p.trim())
        .filter(Boolean);

    // Google OAuth2 credentials
    const googleClientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
    const googleClientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
    const googleRefreshToken = (process.env.GOOGLE_REFRESH_TOKEN || "").trim();

    return {
        lookbackMinutes,
        authorizedInbox,
        allowedDomains,
        adminPasswords,
        googleClientId,
        googleClientSecret,
        googleRefreshToken,
    };
}
