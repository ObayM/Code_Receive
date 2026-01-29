import crypto from "crypto";

function parsePasswordList(value) {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getPasswordHash(passwords) {
  const normalized = passwords.slice().sort().join(",");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export function getAdminAuthConfig() {
  const passwords = parsePasswordList(process.env.ADMIN_PASSWORDS || "");
  const secret = (process.env.ADMIN_SESSION_SECRET || "").trim();
  const sessionHours = Number(process.env.ADMIN_SESSION_HOURS || "24");
  return {
    passwords,
    secret,
    sessionHours: Number.isFinite(sessionHours) ? sessionHours : 24
  };
}

export function isAdminPasswordValid(password) {
  const config = getAdminAuthConfig();
  if (!password || !config.passwords.length) {
    return false;
  }
  return config.passwords.includes(password);
}

export function createAdminSession() {
  const config = getAdminAuthConfig();
  if (!config.secret) {
    throw new Error("Missing ADMIN_SESSION_SECRET.");
  }
  const now = Date.now();
  const expiresAt = now + config.sessionHours * 60 * 60 * 1000;
  const payload = {
    h: getPasswordHash(config.passwords),
    exp: expiresAt
  };
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", config.secret)
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyAdminSession(cookieValue) {
  if (!cookieValue || !cookieValue.includes(".")) {
    return false;
  }
  const [encoded, signature] = cookieValue.split(".", 2);
  if (!encoded || !signature) {
    return false;
  }
  const config = getAdminAuthConfig();
  if (!config.secret || !config.passwords.length) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", config.secret)
    .update(encoded)
    .digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return false;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (!payload || typeof payload !== "object") {
    return false;
  }
  if (!payload.exp || Date.now() > payload.exp) {
    return false;
  }
  const currentHash = getPasswordHash(config.passwords);
  return payload.h === currentHash;
}
