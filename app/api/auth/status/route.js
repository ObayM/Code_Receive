import { checkAuth } from "../../../../lib/imap.js";

export const runtime = "nodejs";

export async function GET() {
  const result = await checkAuth();
  return Response.json(result);
}
