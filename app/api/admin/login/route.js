import { NextResponse } from "next/server";
import { createAdminSession, isAdminPasswordValid } from "@/lib/admin-auth.js";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const password = (body?.password || "").trim();

  // Verify password (still from env)
  if (!isAdminPasswordValid(password)) {
    console.log("[ADMIN-LOGIN] Invalid password attempt");
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let sessionId;
  try {
    sessionId = await createAdminSession();
  } catch (error) {
    console.error("Session creation failed:", error);
    return NextResponse.json({ error: "Session error." }, { status: 500 });
  }

  // Determine if the original request was over HTTPS (handles reverse proxy)
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const isSecure = forwardedProto === "https" || process.env.NODE_ENV === "production";

  const response = NextResponse.json({ ok: true });
  response.cookies.set("admin_session", sessionId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecure,
    maxAge: 60 * 60 * 24 // Cookie age (should match session)
  });

  return response;
}
