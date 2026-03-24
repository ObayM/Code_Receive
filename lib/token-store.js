import { readFile, writeFile, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import logger from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(__dirname, "..", "data", "google-tokens.json");

/**
 * Read the stored refresh token from the JSON file.
 * Falls back to GOOGLE_REFRESH_TOKEN env var if the file doesn't exist yet,
 * and seeds the file so future reads come from disk.
 */
export async function getRefreshToken() {
    try {
        const raw = await readFile(TOKEN_FILE, "utf-8");
        const data = JSON.parse(raw);
        if (data.refresh_token) {
            return data.refresh_token;
        }
    } catch {
        // File doesn't exist or is malformed — fall through to env var
    }

    // Seed from environment variable
    const envToken = (process.env.GOOGLE_REFRESH_TOKEN || "").trim();
    if (envToken) {
        logger.debug("[TOKEN-STORE] Seeding token file from GOOGLE_REFRESH_TOKEN env var");
        await saveRefreshToken(envToken);
        return envToken;
    }

    return null;
}

/**
 * Persist a new refresh token to disk.
 * Called automatically when Google rotates the token.
 */
export async function saveRefreshToken(refreshToken) {
    try {
        await mkdir(dirname(TOKEN_FILE), { recursive: true });
        const data = { refresh_token: refreshToken, updated_at: new Date().toISOString() };
        await writeFile(TOKEN_FILE, JSON.stringify(data, null, 2), "utf-8");
        logger.debug("[TOKEN-STORE] Refresh token saved to %s", TOKEN_FILE);
    } catch (error) {
        logger.error({ err: error }, "[TOKEN-STORE] Failed to save refresh token");
    }
}
