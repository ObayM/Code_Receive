import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetries(task, retries = 2, waitMs = 300) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(waitMs);
      }
    }
  }
  throw lastError;
}

function parseDomainList(value) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowedEmail(email, allowedDomains) {
  if (!allowedDomains.length) {
    return true;
  }
  const domain = email.split("@")[1]?.toLowerCase();
  return Boolean(domain) && allowedDomains.includes(domain);
}

function extractCodes(text) {
  if (!text) {
    return [];
  }
  const matches = text.match(/\b(\d{6}|[A-Za-z0-9]{5}-[A-Za-z0-9]{5})\b/g);
  if (!matches) {
    return [];
  }
  return Array.from(new Set(matches));
}

function normalizeFrom(addresses) {
  if (!addresses || !addresses.length) {
    return "Unknown sender";
  }
  return addresses
    .map((addr) => {
      if (addr.name && addr.address) {
        return `${addr.name} <${addr.address}>`;
      }
      return addr.address || addr.name || "";
    })
    .filter(Boolean)
    .join(", ") || "Unknown sender";
}

function buildMailboxName(host, configured) {
  if (configured) {
    return configured;
  }
  if (host.toLowerCase().includes("gmail.com")) {
    return "[Gmail]/All Mail";
  }
  return "INBOX";
}

function normalizeRecipients(addresses) {
  if (!addresses || !addresses.length) {
    return "Unknown recipient";
  }
  return addresses
    .map((addr) => addr.address || addr.name || "")
    .filter(Boolean)
    .join(", ") || "Unknown recipient";
}

function collectCodesFromMessage(message, parsed) {
  const messageDate = message.envelope?.date || message.internalDate;
  if (!messageDate) {
    return [];
  }

  const text = parsed.text || "";
  const htmlText = typeof parsed.html === "string" ? parsed.html : "";
  const combined = [text, htmlText].filter(Boolean).join("\n");
  const codes = extractCodes(combined);
  if (!codes.length) {
    return [];
  }

  const fromText = parsed.from?.text || normalizeFrom(message.envelope?.from);
  const toText =
    parsed.to?.text ||
    normalizeRecipients(message.envelope?.to) ||
    normalizeRecipients(parsed.to?.value);

  return codes.map((code) => ({
    code,
    from: fromText,
    to: toText,
    timestamp: Math.floor(messageDate.getTime() / 1000),
    time: messageDate.toISOString()
  }));
}

export function getImapConfig() {
  const host = (process.env.IMAP_HOST || "imap.gmail.com").trim();
  const port = Number(process.env.IMAP_PORT || "993");
  const encryption = (process.env.IMAP_ENCRYPTION || "ssl").toLowerCase();
  const secure = encryption !== "" && encryption !== "none";
  const user = (process.env.IMAP_USER || "").trim();
  const password = (process.env.IMAP_PASSWORD || "").trim();
  const lookbackMinutes = Number(process.env.LOOKBACK_MINUTES || "500");
  const authorizedInbox = (process.env.AUTHORIZED_INBOX || "").trim().toLowerCase();
  const allowedDomains = parseDomainList(process.env.ALLOWED_DOMAINS || "");
  const adminPasswords = parseDomainList(process.env.ADMIN_PASSWORDS || "");
  const mailboxName = buildMailboxName(host, process.env.IMAP_MAILBOX || "");

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
    mailboxName
  };
}

export async function fetchCodes(email) {
  const config = getImapConfig();
  if (!email || !email.includes("@")) {
    throw new Error("Please provide a valid email address.");
  }
  if (!isAllowedEmail(email, config.allowedDomains)) {
    throw new Error("Email domain is not allowed.");
  }
  if (!config.user || !config.password) {
    throw new Error("Missing IMAP credentials.");
  }
  if (config.authorizedInbox && config.user.toLowerCase() !== config.authorizedInbox) {
    throw new Error(`Authorized inbox must be ${config.authorizedInbox}.`);
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password
    }
  });

  const lookbackMinutes = Number.isFinite(config.lookbackMinutes) ? config.lookbackMinutes : 500;
  const safeLookback = Math.max(1, lookbackMinutes);
  const cutoff = new Date(Date.now() - safeLookback * 60 * 1000);
  const items = [];

  try {
    await withRetries(async () => {
      await client.connect();
      await client.mailboxOpen(config.mailboxName);
    });

    const searchResults = await client.search({
      since: cutoff,
      to: email
    });

    if (!searchResults.length) {
      return { items, checkedAt: new Date().toISOString() };
    }

    for await (const message of client.fetch(searchResults, {
      envelope: true,
      source: true,
      internalDate: true
    })) {
      const messageDate = message.envelope?.date || message.internalDate;
      if (!messageDate || messageDate < cutoff) {
        continue;
      }

      const parsed = await simpleParser(message.source);
      const entries = collectCodesFromMessage(message, parsed);
      entries.forEach((entry) => {
        items.push({
          code: entry.code,
          from: entry.from,
          timestamp: entry.timestamp,
          time: entry.time
        });
      });
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore logout errors.
    }
  }

  return {
    items,
    checkedAt: new Date().toISOString()
  };
}

export async function checkAuth() {
  const config = getImapConfig();
  if (!config.user || !config.password) {
    return {
      authenticated: false,
      message: "Missing IMAP credentials in .env."
    };
  }
  if (config.authorizedInbox && config.user.toLowerCase() !== config.authorizedInbox) {
    return {
      authenticated: false,
      message: "IMAP user must match the authorized inbox."
    };
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password
    }
  });

  try {
    await withRetries(async () => {
      await client.connect();
      await client.mailboxOpen(config.mailboxName);
    });
    return {
      authenticated: true,
      message: "IMAP connected. Ready to search."
    };
  } catch (error) {
    return {
      authenticated: false,
      message: error?.message || "IMAP login failed. Check IMAP credentials."
    };
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore logout errors.
    }
  }
}

export async function fetchAllCodes() {
  const config = getImapConfig();
  if (!config.user || !config.password) {
    throw new Error("Missing IMAP credentials.");
  }
  if (config.authorizedInbox && config.user.toLowerCase() !== config.authorizedInbox) {
    throw new Error(`Authorized inbox must be ${config.authorizedInbox}.`);
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password
    }
  });

  const lookbackMinutes = Number.isFinite(config.lookbackMinutes) ? config.lookbackMinutes : 500;
  const safeLookback = Math.max(1, lookbackMinutes);
  const cutoff = new Date(Date.now() - safeLookback * 60 * 1000);
  const items = [];

  try {
    await withRetries(async () => {
      await client.connect();
      await client.mailboxOpen(config.mailboxName);
    });

    const searchResults = await client.search({
      since: cutoff
    });

    if (!searchResults.length) {
      return { items, checkedAt: new Date().toISOString() };
    }

    for await (const message of client.fetch(searchResults, {
      envelope: true,
      source: true,
      internalDate: true
    })) {
      const messageDate = message.envelope?.date || message.internalDate;
      if (!messageDate || messageDate < cutoff) {
        continue;
      }

      const parsed = await simpleParser(message.source);
      const entries = collectCodesFromMessage(message, parsed);
      entries.forEach((entry) => items.push(entry));
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // Ignore logout errors.
    }
  }

  return {
    items,
    checkedAt: new Date().toISOString()
  };
}

export function isAdminPasswordValid(password) {
  const config = getImapConfig();
  if (!password || !config.adminPasswords.length) {
    return false;
  }
  return config.adminPasswords.includes(password);
}
