import { fetchAllCodes } from "../../../../lib/imap.js";
import { verifyAdminSession } from "../../../../lib/admin-auth.js";

export const runtime = "nodejs";

export async function GET(request) {
  const cookie = request.headers.get("cookie") || "";
  const sessionCookie = cookie
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("admin_session="));
  const sessionValue = sessionCookie ? sessionCookie.split("=")[1] : "";
  if (!verifyAdminSession(sessionValue)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  try {
    const data = await fetchAllCodes();
    return Response.json({
      items: data.items || [],
      checkedAt: data.checkedAt || new Date().toISOString()
    });
  } catch (error) {
    const message = error?.message || "IMAP login failed. Check IMAP credentials.";
    const status = message.toLowerCase().includes("missing imap credentials") ? 401 : 500;
    return Response.json({ error: message }, { status });
  }
}
