/**
 * Unit tests for sync.js code extraction logic.
 *
 * We copy the pure functions here to test in isolation (sync.js imports
 * gmail.js which requires googleapis — not available in bare node --test).
 *
 * Run with: node --test lib/__tests__/sync.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Exact copies of pure functions from sync.js ──

const CODE_REGEX = /(?<!\d)(?<!\.)(\d{6})(?!\d)/g;

function extractCodes(text) {
    if (!text) return [];
    const matches = text.match(CODE_REGEX);
    return matches ? Array.from(new Set(matches)) : [];
}

function stripHtmlTags(html) {
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&#?\w+;/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}

// ── Tests ──

describe("extractCodes", () => {
    it("extracts a single 6-digit code from plain text", () => {
        const codes = extractCodes("Your verification code is 123456. Please enter it.");
        assert.deepStrictEqual(codes, ["123456"]);
    });

    it("returns unique codes only (deduplication)", () => {
        const codes = extractCodes("Code: 123456. Reminder: your code is 123456.");
        assert.deepStrictEqual(codes, ["123456"]);
    });

    it("returns empty array when no codes present", () => {
        assert.deepStrictEqual(extractCodes("Hello, no codes here."), []);
    });

    it("returns empty array for null/undefined input", () => {
        assert.deepStrictEqual(extractCodes(null), []);
        assert.deepStrictEqual(extractCodes(undefined), []);
        assert.deepStrictEqual(extractCodes(""), []);
    });

    it("extracts multiple different codes", () => {
        const codes = extractCodes("First code: 111111. Second code: 222222.");
        assert.equal(codes.length, 2);
        assert(codes.includes("111111"));
        assert(codes.includes("222222"));
    });

    it("does NOT extract codes embedded in decimals (3.141592)", () => {
        assert.deepStrictEqual(extractCodes("Pi is approximately 3.141592"), []);
    });

    it("does NOT extract 5-digit or 7-digit numbers", () => {
        assert.deepStrictEqual(extractCodes("12345"), []);
        assert.deepStrictEqual(extractCodes("1234567"), []);
    });
});

describe("stripHtmlTags", () => {
    it("strips basic HTML tags", () => {
        const result = stripHtmlTags("<p>Your code is <b>123456</b></p>");
        assert(result.includes("123456"));
        assert(!result.includes("<"));
    });

    it("strips style and script blocks entirely", () => {
        const html = '<style>.foo{color:red}</style><p>Code: 654321</p><script>alert("hi")</script>';
        const result = stripHtmlTags(html);
        assert(result.includes("654321"));
        assert(!result.includes("color:red"));
        assert(!result.includes("alert"));
    });

    it("decodes &nbsp; entities", () => {
        assert(stripHtmlTags("Hello&nbsp;World").includes("Hello World"));
    });

    it("handles empty string", () => {
        assert.equal(stripHtmlTags(""), "");
    });
});

describe("HTML-only emails", () => {
    it("extracts exactly 1 code from verification email HTML", () => {
        const html = `<html><body>
            <h2>Your Verification Code</h2>
            <div style="font-size:24px"><span>789012</span></div>
        </body></html>`;
        const codes = extractCodes(stripHtmlTags(html));
        assert.deepStrictEqual(codes, ["789012"]);
    });
});

describe("THE ORIGINAL BUG: multipart email", () => {
    it("NEW fix: produces exactly 1 code (not 2 or 3)", () => {
        const textContent = "Your verification code is 456789. It expires in 5 minutes.";
        const htmlContent = "<p>Your verification code is <b>456789</b>.</p>";

        // The fix: prefer text/plain, don't concatenate text + HTML
        let searchText = textContent.trim();
        if (!searchText && htmlContent) {
            searchText = stripHtmlTags(htmlContent);
        }

        const codes = extractCodes(searchText);
        assert.deepStrictEqual(codes, ["456789"],
            `Expected 1 code but got ${codes.length}: ${JSON.stringify(codes)}`);
    });

    it("falls back to HTML when no text/plain exists", () => {
        const textContent = "";
        const htmlContent = "<p>Code: <strong>999888</strong></p>";

        let searchText = textContent.trim();
        if (!searchText && htmlContent) {
            searchText = stripHtmlTags(htmlContent);
        }

        assert.deepStrictEqual(extractCodes(searchText), ["999888"]);
    });
});
