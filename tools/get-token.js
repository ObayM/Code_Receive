/**
 * Gmail OAuth2 Token Helper
 *
 * Run this once to get a refresh token:
 *   node tools/get-token.js
 *
 * Prerequisites:
 *   1. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
 *   2. In Google Cloud Console, add https://e40f-197-43-23-32.ngrok-free.app/oauth2callback
 *      as an authorized redirect URI for your OAuth client
 */

import "dotenv/config";
import { google } from "googleapis";
import http from "http";
import { URL } from "url";
import { saveRefreshToken } from "../lib/token-store.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "https://e40f-197-43-23-32.ngrok-free.app/oauth2callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(" Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file first.");
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
});

console.log("\n🔗 Open this URL in your browser:\n");
console.log(authUrl);
console.log("\n⏳ Waiting for OAuth callback on https://e40f-197-43-23-32.ngrok-free.app ...\n");

const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "https://e40f-197-43-23-32.ngrok-free.app");

    if (url.pathname !== "/oauth2callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
    }

    const code = url.searchParams.get("code");
    if (!code) {
        res.writeHead(400);
        res.end("Missing code parameter");
        return;
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>✅ Success!</h1><p>You can close this tab. Check your terminal for the refresh token.</p>");

        console.log("✅ Got tokens!\n");
        console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

        // Save to persistent token store so the app picks it up automatically
        await saveRefreshToken(tokens.refresh_token);
        console.log("💾 Saved refresh token to data/google-tokens.json\n");

        server.close();
        process.exit(0);
    } catch (error) {
        res.writeHead(500);
        res.end(`Error: ${error.message}`);
        console.error("❌ Token exchange failed:", error.message);
        server.close();
        process.exit(1);
    }
});

server.listen(3000, () => {
    console.log("Listening on port 3000...");
});
