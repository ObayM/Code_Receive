import { prisma } from "@/lib/db";
import { startSyncLoop } from "@/lib/sync";
import { verifyAdminSession } from "@/lib/admin-auth";
import { getAppConfig } from "@/lib/config";
import logger from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(request) {
  const cookie = request.headers.get("cookie") || "";
  const sessionCookie = cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("admin_session="));
  const sessionValue = sessionCookie ? sessionCookie.split("=")[1] : "";

  if (!(await verifyAdminSession(sessionValue))) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Ensure background sync is running (idempotent)
  startSyncLoop();

  try {
    const config = getAppConfig();
    const lookbackMinutes = config.lookbackMinutes || 8;
    const codes = await prisma.code.findMany({
      where: {
        receivedAt: {
          gt: new Date(Date.now() - lookbackMinutes * 60 * 1000)
        }
      },
      orderBy: {
        receivedAt: "desc"
      },
      take: 100
    });

    return Response.json({
      items: codes.map(c => ({
        code: c.code, // Admin sees raw codes
        from: c.from,
        to: c.email,
        timestamp: Math.floor(c.receivedAt.getTime() / 1000),
        time: c.receivedAt.toISOString(),
        isProtected: c.isProtected
      })),
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error({ err: error }, "Database error");
    return Response.json({ error: "Database error" }, { status: 500 });
  }
}
