"use strict";

const DISCORD_SAFE_LENGTH = 1900;

const SHORT_CHAT_TYPES = new Set(["greeting", "affection", "provocation", "dismissal"]);
const ASSISTANT_SCRIPT =
    /\b(?:as an ai|i(?:'m| am) here to (?:help|assist)|i(?:'m| am) (?:just )?an ai|feel free to ask|how can i (?:help|assist)|main (?:ek )?ai|madad ke liye|madad karne ke liye|aapki baat kaafi sweet lag rahi hai|bauaa ka naam (?:aapne|tumne)|mujhe lagta hai (?:aap|tum).*?upset)\b|मैं (?:एक )?(?:एआई|ai) हूँ|मदद के लिए|હું (?:એક )?(?:એઆઈ|ai) છું|મદદ માટે/iu;
const ROAST_EMOJI = /\p{Extended_Pictographic}/u;
const ROAST_ACKNOWLEDGMENT =
    /^(?:okay|ok|alright|sure|nice|(?:th[ei]+k|sahi) hai(?: bhai)?|samajh gayi|ठीक है|समझ गई|ઠીક છે|સારું)[.!।\s\uFE0F\p{Extended_Pictographic}]*$/iu;
const roastFallbackPositions = new WeakMap();
const SHORT_CHAT_FALLBACKS = {
    hinglish: {
        greeting: "Hey, kya haal?",
        affection: "Aww, ye sweet tha.",
        romantic: "Tumhari ye baat seedha dil pe lagi 🤍",
        provocation: "Point hai toh seedha bol.",
        owner: "Bauaa pe gaali dene se point strong nahi hota.",
        roast: [
            "Itni bakchodi aur punchline abhi bhi loading pe hai 💀",
            "Confidence full volume pe, logic gaya bhaad mein 🤡",
            "Badi zabardast bakchodi thi, bas kisi baat ka matlab hota toh maza aata 😭",
        ],
        toxicOwner: [
            "Bauaa pe bakchodi ka punchline bhi loading pe atka hai 🤡",
            "Bauaa pe shot liya aur teri bakchodi ne khud ka goal kar diya 💀",
        ],
        dismissal: "Theek hai.",
    },
    english: {
        greeting: "Hey!",
        affection: "Aw, that was sweet.",
        romantic: "That went straight to my heart 🤍",
        provocation: "Got a point? Make it.",
        owner: "Insulting Bauaa doesn't make your point.",
        roast: [
            "That's a whole lot of bullshit for zero punchline 💀",
            "Confidence at full volume and the logic sounds like shit 🤡",
            "The bullshit arrived right on time. The point missed its bus 😭",
        ],
        toxicOwner: [
            "All that shit about Bauaa and the punchline still missed 🤡",
            "That shot at Bauaa had the aim of a busted-ass sprinkler 💀",
        ],
        dismissal: "Alright.",
    },
    hindi: {
        greeting: "अरे, कैसे हो?",
        affection: "ये सुनकर अच्छा लगा।",
        romantic: "तुम्हारी ये बात सीधे दिल को छू गई 🤍",
        provocation: "कोई बात है तो सीधे बोलो।",
        owner: "बाउआ को गाली देने से तुम्हारी बात सही नहीं हो जाती।",
        roast: [
            "इतनी बकचोदी और मज़ाक अब भी लोड हो रहा है 💀",
            "आवाज़ पूरी, तर्क गया भाड़ में 🤡",
            "बकचोदी वक्त पर आ गई, मुद्दे की बस छूट गई 😭",
        ],
        toxicOwner: [
            "बाउआ पर इतनी बकचोदी और तंज़ भी निशाने से बाहर 🤡",
            "बाउआ पर निशाना था, बकचोदी वापस तेरे पाले में आ गई 💀",
        ],
        dismissal: "ठीक है।",
    },
    gujarati: {
        greeting: "અરે, કેમ છો?",
        affection: "આ સાંભળીને મજા આવી.",
        romantic: "તારી આ વાત સીધી દિલને અડી ગઈ 🤍",
        provocation: "કંઈ કહેવું હોય તો સીધું કહો.",
        owner: "બાઉઆને ગાળો આપવાથી તમારી વાત સાચી નથી થઈ જતી.",
        roast: [
            "આટલી બકચોદી પછીય જોક હજી લોડ થાય છે 💀",
            "અવાજ ફુલ ને તર્ક ગયો ભાડમાં 🤡",
            "બકચોદી સમયસર આવી ગઈ, મુદ્દાની બસ છૂટી ગઈ 😭",
        ],
        toxicOwner: [
            "બાઉઆ પર આટલી બકચોદી ને ટોણોય નિશાન ચૂકી ગયો 🤡",
            "નિશાન બાઉઆ પર હતું, બકચોદી ફરી તારી પાસે જ આવી 💀",
        ],
        dismissal: "ઠીક છે.",
    },
};

function formatShortChatReply(response, { type, language, mood, bauaaMentioned, roast = false }) {
    const replies = SHORT_CHAT_FALLBACKS[language] || SHORT_CHAT_FALLBACKS.hinglish;
    if (type === "dismissal") return replies.dismissal;

    // Keep a complete conversational line and drop support-script filler.
    const separator = roast
        ? /(?<=[.!?।])[^\S\r\n]+(?![^\S\r\n]*\p{Extended_Pictographic})|\r?\n+/u
        : /(?<=[.!?।])\s+|\r?\n+/u;
    const line = String(response ?? "").split(separator)
        .map(sentence => sentence.trim().replace(/’/g, "'"))
        .find(sentence => sentence && sentence.length <= 140 &&
            sentence.split(/\s+/u).length <= 18 && !ASSISTANT_SCRIPT.test(sentence) &&
            (!roast || (/\p{L}/u.test(sentence) && !/[?？؟]/u.test(sentence) && !ROAST_ACKNOWLEDGMENT.test(sentence))));
    if (line) return roast && !ROAST_EMOJI.test(line) ? `${line} 💀` : line;

    if (roast) {
        const options = type === "provocation" && bauaaMentioned ? replies.toxicOwner : replies.roast;
        const position = roastFallbackPositions.get(options) ?? 0;
        roastFallbackPositions.set(options, (position + 1) % options.length);
        return options[position];
    }
    if (type === "affection" && mood === "romantic") return replies.romantic;
    if (type === "provocation" && bauaaMentioned) return replies.owner;
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
