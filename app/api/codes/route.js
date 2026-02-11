import { prisma } from "@/lib/db";
import { startSyncLoop } from "@/lib/sync";
import { getImapConfig } from "@/lib/imap";

export const runtime = "nodejs";

export async function GET(request) {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    return Response.json({ error: "Please provide a valid email address." }, { status: 400 });
  }

  // Enforce ALLOWED_DOMAINS
  const config = getImapConfig();
  if (config.allowedDomains.length > 0) {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || !config.allowedDomains.includes(domain)) {
      return Response.json({ error: "Email domain is not allowed." }, { status: 403 });
    }
  }

  // Ensure background sync is running (idempotent)
  startSyncLoop();

  try {
    const codes = await prisma.code.findMany({
      where: {
        email: email,
        receivedAt: {
          gt: new Date(Date.now() - 8 * 60 * 1000) // Last 8 minutes
        }
      },
      orderBy: {
        receivedAt: "desc"
      }
    });

    return Response.json({
      email,
      items: codes.map(c => ({
        code: c.isProtected ? "******" : c.code,
        from: c.from,
        timestamp: Math.floor(c.receivedAt.getTime() / 1000),
        time: c.receivedAt.toISOString(),
        isProtected: c.isProtected
      })),
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error("Database error:", error);
    return Response.json({ error: "Database error" }, { status: 500 });
  }
}
