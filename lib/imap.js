import { ImapFlow } from "imapflow";

/**
 * Get IMAP configuration from environment variables
 */
export function getImapConfig() {
  const host = (process.env.IMAP_HOST || "imap.gmail.com").trim();
  const port = Number(process.env.IMAP_PORT || "993");
  const encryption = (process.env.IMAP_ENCRYPTION || "ssl").toLowerCase();
  const secure = encryption !== "" && encryption !== "none";
  const user = (process.env.IMAP_USER || "").trim();
  const password = (process.env.IMAP_PASSWORD || "").trim();
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

  const mailboxName = (process.env.IMAP_MAILBOX || "[Gmail]/All Mail").trim();

  return {
    host,
    port,
    secure,
    user,
    password,
    lookbackMinutes,
    authorizedInbox,
    allowedDomains,
    adminPasswords,
    mailboxName,
  };
}

/**
 * Test IMAP connection - actually verifies credentials work
 * Returns { success: boolean, message: string }
 */
export async function testImapConnection() {
  const config = getImapConfig();

  if (!config.user || !config.password) {
    return {
      success: false,
      message: "IMAP credentials not configured in .env"
    };
  }

  let client = null;
  try {
    client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
      logger: false,
    });

    await client.connect();
    await client.mailboxOpen(config.mailboxName);
    await client.logout();

    return {
      success: true,
      message: "IMAP connected. Ready to search."
    };
  } catch (error) {
    return {
      success: false,
      message: `IMAP connection failed: ${error.message}`
    };
  } finally {
    if (client) {
      try { await client.logout(); } catch { }
    }
  }
}
