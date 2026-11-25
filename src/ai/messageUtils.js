"use strict";

const DISCORD_SAFE_LENGTH = 1900;

const SHORT_CHAT_TYPES = new Set(["greeting", "affection", "provocation", "dismissal"]);
const ASSISTANT_SCRIPT =
    /\b(?:as an ai|i(?:'m| am) here to (?:help|assist)|i(?:'m| am) (?:just )?an ai|feel free to ask|how can i (?:help|assist)|main (?:ek )?ai|madad ke liye|madad karne ke liye|aapki baat kaafi sweet lag rahi hai|bauaa ka naam (?:aapne|tumne)|mujhe lagta hai (?:aap|tum).*?upset)\b|मैं (?:एक )?(?:एआई|ai) हूँ|मदद के लिए|હું (?:એક )?(?:એઆઈ|ai) છું|મદદ માટે/iu;
const SHORT_CHAT_FALLBACKS = {
    hinglish: {
        greeting: "Hey, kya haal?",
        affection: "Aww, ye sweet tha.",
        romantic: "Aww, itne cute kab se ho?",
        provocation: "Point hai toh seedha bol.",
        owner: "Bauaa pe gaali dene se point strong nahi hota.",
        toxicOwner: "Bauaa pe bakchodi se point prove nahi hota.",
        dismissal: "Theek hai.",
    },
    english: {
        greeting: "Hey!",
        affection: "Aw, that was sweet.",
        romantic: "Aw, look at you being all cute.",
        provocation: "Got a point? Make it.",
        owner: "Insulting Bauaa doesn't make your point.",
        toxicOwner: "Talking shit about Bauaa doesn't prove a thing.",
        dismissal: "Alright.",
    },
    hindi: {
        greeting: "अरे, कैसे हो?",
        affection: "ये सुनकर अच्छा लगा।",
        romantic: "अरे, आज इतने प्यारे कैसे लग रहे हो?",
        provocation: "कोई बात है तो सीधे बोलो।",
        owner: "बाउआ को गाली देने से तुम्हारी बात सही नहीं हो जाती।",
        toxicOwner: "बाउआ पर बकवास करने से कुछ साबित नहीं होता।",
        dismissal: "ठीक है।",
    },
    gujarati: {
        greeting: "અરે, કેમ છો?",
        affection: "આ સાંભળીને મજા આવી.",
        romantic: "અરે, આજે આટલા મીઠા કેમ?",
        provocation: "કંઈ કહેવું હોય તો સીધું કહો.",
        owner: "બાઉઆને ગાળો આપવાથી તમારી વાત સાચી નથી થઈ જતી.",
        toxicOwner: "બાઉઆ વિશે બકવાસ કરવાથી કંઈ સાબિત નથી થતું.",
        dismissal: "ઠીક છે.",
    },
};

function formatShortChatReply(response, { type, language, mood, bauaaMentioned }) {
    const replies = SHORT_CHAT_FALLBACKS[language] || SHORT_CHAT_FALLBACKS.hinglish;
    if (type === "dismissal") return replies.dismissal;

    // Keep a complete conversational line and drop support-script filler.
    const line = String(response ?? "").split(/(?<=[.!?।])\s+|\r?\n+/u)
        .map(sentence => sentence.trim().replace(/’/g, "'"))
        .find(sentence => sentence && sentence.length <= 140 &&
            sentence.split(/\s+/u).length <= 18 && !ASSISTANT_SCRIPT.test(sentence));
    if (line) return line;

    if (type === "affection" && mood === "romantic") return replies.romantic;
    if (type === "provocation" && bauaaMentioned) {
        return mood === "very_toxic" ? replies.toxicOwner : replies.owner;
    }
    return replies[type];
}

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
    SHORT_CHAT_TYPES,
    formatShortChatReply,
    splitMessage,
    tokenize,
    estimateTokens,
};
