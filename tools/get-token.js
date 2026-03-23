/**
 * Gmail OAuth2 Token Helper
 *
 * Run this to get a refresh token:
 *
 *   LOCAL mode (you're on the same machine):
 *     node tools/get-token.js
 *
 *   REMOTE mode (someone else authorizes from a different machine):
 *     node tools/get-token.js --remote
 *     They open the URL, authorize, then paste the redirect URL back.
 *
 * Prerequisites:
 *   1. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env
 *   2. In Google Cloud Console, add http://localhost:3000/oauth2callback
 *      as an authorized redirect URI for your OAuth client
 */

import "dotenv/config";
import { google } from "googleapis";
import http from "http";
import { URL } from "url";
import readline from "readline";
import { saveRefreshToken } from "../lib/token-store.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/oauth2callback";
const isRemote = process.argv.includes("--remote");

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("❌ Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your .env file first.");
    process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // Force consent screen to always get a refresh token
    scope: ["https://www.googleapis.com/auth/gmail.readonly"],
});

/**
 * Exchange the authorization code for tokens and save.
 */
async function exchangeCodeAndSave(code) {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
        console.error(
            "\n⚠️  No refresh token received!\n" +
            "This usually means you've already authorized this app.\n" +
            "Go to https://myaccount.google.com/permissions , revoke access\n" +
            "for this app, then run this tool again.\n"
        );
        process.exit(1);
    }

    console.log("\n✅ Got tokens!\n");
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);

    await saveRefreshToken(tokens.refresh_token);
    console.log("💾 Saved refresh token to data/google-tokens.json\n");
}

// ─── REMOTE MODE ───
// The person authorizing opens the URL in their browser.
// Google redirects to localhost (which won't load on their machine),
// but the auth code is visible in the URL bar. They paste it back here.
if (isRemote) {
    console.log("\n🔗 Send this URL to the person who needs to authorize:\n");
    console.log(authUrl);
    console.log(
        "\n📋 After they authorize, Google will redirect their browser to a\n" +
        "   localhost URL that won't load. That's fine!\n" +
        "   Ask them to copy the FULL URL from their browser's address bar\n" +
        "   and paste it below.\n"
    );

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.question("⏳ Paste the full redirect URL here: ", async (urlStr) => {
        rl.close();

        try {
            const redirectUrl = new URL(urlStr.trim());
            const code = redirectUrl.searchParams.get("code");

            if (!code) {
                console.error("❌ No 'code' parameter found in that URL. Make sure you pasted the full URL.");
                process.exit(1);
            }

            await exchangeCodeAndSave(code);
            process.exit(0);
        } catch (error) {
            console.error("❌ Failed:", error.message);
            process.exit(1);
        }
    });

// ─── LOCAL MODE ───
// Runs a local HTTP server to catch the OAuth callback automatically.
} else {
    console.log("\n🔗 Open this URL in your browser:\n");
    console.log(authUrl);
    console.log("\n⏳ Waiting for OAuth callback on http://localhost:3000 ...\n");

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://localhost:3000");

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
            await exchangeCodeAndSave(code);

            res.writeHead(200, { "Content-Type": "text/html" });
            res.end("<h1>✅ Success!</h1><p>You can close this tab.</p>");

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
        console.log("Listening on http://localhost:3000 ...");
    });
}
