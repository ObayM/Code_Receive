import { prisma } from "./db";

function parsePasswordList(str) {
  return (str || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

export function isAdminPasswordValid(password) {
  const adminPasswords = parsePasswordList(process.env.ADMIN_PASSWORDS);
  if (!password || !adminPasswords.length) {
    console.log("[ADMIN-AUTH] No password provided or ADMIN_PASSWORDS is empty. Configured count:", adminPasswords.length);
    return false;
  }
  const valid = adminPasswords.includes(password);
  if (!valid) {
    console.log("[ADMIN-AUTH] Password mismatch. Configured passwords count:", adminPasswords.length);
  }
  return valid;
}

export async function createAdminSession() {
  // Configured session duration or default 24h
  const sessionHours = Number(process.env.ADMIN_SESSION_HOURS || "24");
  const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000);

  const session = await prisma.adminSession.create({
    data: {
      expiresAt
    }
  });

  return session.id;
}

export async function verifyAdminSession(sessionId) {
  if (!sessionId) return false;

  const session = await prisma.adminSession.findUnique({
    where: { id: sessionId }
  });

  if (!session) return false;

  if (session.expiresAt < new Date()) {
    // Clean up expired session
    await prisma.adminSession.delete({ where: { id: sessionId } }).catch(() => { });
    return false;
  }

  return true;
}
