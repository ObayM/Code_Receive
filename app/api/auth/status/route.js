import { testGmailConnection } from "@/lib/gmail.js";

export const runtime = "nodejs";

// Cache the auth status for 60 seconds
let cachedStatus = null;
let cacheExpiry = 0;

export async function GET() {
  const now = Date.now();

  if (cachedStatus && now < cacheExpiry) {
    return Response.json(cachedStatus);
  }

  const result = await testGmailConnection();

  const response = {
    authenticated: result.success,
    message: result.message
  };

  cachedStatus = response;
  cacheExpiry = now + 60000;

  return Response.json(response);
}
