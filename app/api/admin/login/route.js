import { NextResponse } from "next/server";
import { createAdminSession, isAdminPasswordValid } from "../../../../lib/admin-auth.js";

export const runtime = "nodejs";

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const password = (body?.password || "").trim();
  if (!isAdminPasswordValid(password)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let session;
  try {
    session = createAdminSession();
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Session error." }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("admin_session", session, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24
  });
  return response;
}
