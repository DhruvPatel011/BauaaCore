"use strict";

const DISCORD_SAFE_LENGTH = 1900;

/**
 * Split a long response into Discord-safe chunks.
 * - Prefers newline, then space boundaries.
 * - Never splits a surrogate pair.
 * - If a split lands inside a ``` code block, the block is closed at the end
 *   of the chunk and re-opened (with its language tag) in the next chunk.
 */
function splitMessage(content, maxLength = DISCORD_SAFE_LENGTH) {
    // Reserve room for a closing fence appended to a chunk.
    const limit = Math.max(100, maxLength - 25);
    const chunks = [];
    let remaining = String(content ?? "").trim();

    while (remaining.length > limit) {
        let splitAt = remaining.lastIndexOf("\n", limit);

        if (splitAt < limit * 0.5) splitAt = remaining.lastIndexOf(" ", limit);
        if (splitAt < limit * 0.5) splitAt = limit;

        const previous = remaining.charCodeAt(splitAt - 1);
        if (previous >= 0xd800 && previous <= 0xdbff) splitAt -= 1;

        let chunk = remaining.slice(0, splitAt).trimEnd();
        const skip = /\s/.test(remaining[splitAt] || "") ? 1 : 0;
        let rest = remaining.slice(splitAt + skip).replace(/^\n+/, "");

        const fences = chunk.match(/```/g) || [];

        if (fences.length % 2 === 1) {
            const openers = [...chunk.matchAll(/```([^\n`]*)/g)];
            const lang = (openers[openers.length - 1][1] || "").trim().slice(0, 15);

            chunk += "\n```";
            rest = "```" + lang + "\n" + rest;
        }

        if (chunk.trim()) chunks.push(chunk);
        remaining = rest;
    }

    if (remaining.trim()) chunks.push(remaining.trimEnd());

    return chunks;
}

const STOPWORDS = new Set([
    "the", "and", "for", "with", "that", "this", "you", "are", "was", "have",
    "what", "how", "can", "please", "about", "from", "not", "but", "your",
    "mera", "meri", "mere", "hai", "hain", "kya", "mein", "aur", "toh", "nahi",
]);

function tokenize(text) {
    const matches = String(text ?? "").toLowerCase().match(/[\p{L}\p{N}_.#+-]+/gu) || [];

    return matches
        .map(word => word.replace(/^[.\-+#]+|[.\-]+$/g, ""))
        .filter(word => word.length >= 3 && !STOPWORDS.has(word));
}

/**
 * Conservative token estimate. Non-ASCII scripts (Devanagari, Gujarati, ...)
 * tokenize far less efficiently than English, so they are weighted heavier.
 */
function estimateTokens(text) {
    const value = String(text ?? "");
    let ascii = 0;
    let other = 0;

    for (const char of value) {
        if (char.charCodeAt(0) < 128) ascii += 1;
        else other += 1;
    }

    return Math.ceil(ascii / 3.5 + other / 1.2);
}

module.exports = {
    DISCORD_SAFE_LENGTH,
    splitMessage,
    tokenize,
    estimateTokens,
};
