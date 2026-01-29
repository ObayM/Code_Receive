import { fetchCodes } from "../../../lib/imap.js";

export const runtime = "nodejs";

function errorStatus(message) {
  const lower = message.toLowerCase();
  if (lower.includes("valid email")) {
    return 400;
  }
  if (lower.includes("not allowed")) {
    return 403;
  }
  if (lower.includes("missing imap credentials")) {
    return 401;
  }
  if (lower.includes("authorized inbox")) {
    return 403;
  }
  return 500;
}

export async function GET(request) {
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return Response.json({ error: "Please provide a valid email address." }, { status: 400 });
  }

  try {
    const data = await fetchCodes(email);
    return Response.json({
      email,
      items: data.items || [],
      checkedAt: data.checkedAt || new Date().toISOString()
    });
  } catch (error) {
    const message = error?.message || "IMAP login failed. Check IMAP credentials.";
    return Response.json({ error: message }, { status: errorStatus(message) });
  }
}
