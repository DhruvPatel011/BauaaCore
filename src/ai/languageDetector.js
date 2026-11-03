
"use strict";

/**
 * BauaaCore Multilingual Language Detector
 *
 * INPUT:
 * - Understand messages written in any language.
 *
 * OUTPUT:
 * - English
 * - Hinglish (Roman Hindi + English)
 *
 * Rules:
 * - Hindi / Hinglish input -> Hinglish output.
 * - English input -> English output.
 * - Gujarati and all other languages -> English output.
 * - Never generate replies in a third language.
 */

const SCRIPT_PATTERNS = [
    {
        key: "hindi",
        regex: /[\u0900-\u097F]/g,
    },
    {
        key: "gujarati",
        regex: /[\u0A80-\u0AFF]/g,
    },
    {
        key: "other",
        regex: /[\u0600-\u06FF\u0750-\u077F\u0980-\u09FF\u0B00-\u0D7F\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u3400-\u9FFF\u0400-\u04FF\u0370-\u03FF\u0590-\u05FF]/g,
    },
];

const HINDI_WORDS = new Set([
    "kya", "hai", "hain", "hoon", "hu", "nahi", "nahin", "nhi",
    "kaise", "kese", "kaisa", "kyu", "kyun", "kyon",
    "kab", "kahan", "kaha", "mujhe", "mujhko",
    "mera", "meri", "mere", "tera", "teri", "tere",
    "tumhara", "aapka", "aap", "tum", "tu",
    "yeh", "ye", "woh", "wo", "iska", "uska",
    "chahiye", "chahie", "accha", "acha", "achha",
    "theek", "thik", "abhi", "bata", "batao",
    "bolo", "bol", "karo", "karna", "kar", "kr",
    "kiya", "karke", "kaam", "yaar", "yar",
    "bhai", "kuch", "koi", "lekin", "magar",
    "aur", "haan", "han", "toh", "matlab",
    "kyunki", "wala", "wali", "raha", "rahi",
    "rahe", "liye", "hua", "hoga", "hogi",
    "sab", "sabko", "bahut", "bohot", "bhot",
    "sirf", "phir", "fir", "pehle", "pahle",
    "jao", "aao", "chalo", "dekh", "dekho",
    "samajh", "samjha", "samjhao", "sahi",
    "galat", "zyada", "jyada", "thoda",
    "thodi", "likh", "likho", "likhna",
    "bana", "banao", "dikha", "dikhao",
    "mein", "mai", "me", "mujh", "apna",
    "apni", "apne", "karna", "krega", "karega",
    "kregi", "karegi", "kro", "krna",
]);

const GUJARATI_ROMAN_WORDS = new Set([
    "che", "chhe", "chu", "chhu", "chho",
    "shu", "mane", "tane", "tamne",
    "mara", "mari", "maru", "tara",
    "tari", "taru", "amne", "amara",
    "joie", "joiye", "kem", "kevu",
    "kevi", "kevo", "ame", "tame",
    "nathi", "saru", "saras", "ane",
    "thayu", "karvu", "maate", "aavjo",
    "hatu", "hati", "kaho", "vaat",
    "kyare", "ketlu", "ketla", "aave",
    "aavyo", "gayo", "gayu", "aavu",
]);

function cleanMessage(text) {
    return String(text ?? "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/<a?:\w+:\d+>/g, " ")
        .replace(/<[@#&!]+\d+>/g, " ")
        .trim();
}

function countMatches(text, regex) {
    return (text.match(regex) || []).length;
}

function getRomanLanguage(text) {
    const words = text.toLowerCase().match(/[a-z]+/g) || [];

    if (!words.length) {
        return "english";
    }

    let hindiCount = 0;
    let gujaratiCount = 0;

    for (const word of words) {
        if (GUJARATI_ROMAN_WORDS.has(word)) {
            gujaratiCount++;
        } else if (HINDI_WORDS.has(word)) {
            hindiCount++;
        }
    }

    // Gujarati written in Roman letters always receives English output.
    if (gujaratiCount >= 2 && gujaratiCount > hindiCount) {
        return "english";
    }

    // Avoid classifying casual English containing only "bhai" as Hinglish.
    const meaningfulHindiCount = words.filter(word =>
        HINDI_WORDS.has(word) && word !== "bhai" && word !== "yar"
    ).length;

    const hindiRatio = meaningfulHindiCount / words.length;

    if (
        meaningfulHindiCount >= 2 ||
        (meaningfulHindiCount >= 1 && hindiRatio >= 0.20)
    ) {
        return "hinglish";
    }

    return "english";
}

function createResult(key, label, directive, confidence) {
    return {
        key,
        label,
        outputLanguage: key,
        directive,
        confidence,
    };
}

function detectLanguage(text) {
    const cleaned = cleanMessage(text);

    const hindiCount = countMatches(
        cleaned,
        SCRIPT_PATTERNS[0].regex
    );

    const gujaratiCount = countMatches(
        cleaned,
        SCRIPT_PATTERNS[1].regex
    );

    const otherCount = countMatches(
        cleaned,
        SCRIPT_PATTERNS[2].regex
    );

    // Native Hindi / Devanagari input.
    if (hindiCount > 0 && hindiCount >= gujaratiCount) {
        return createResult(
            "hinglish",
            "Hindi",
            "Reply ONLY in Hinglish using Roman (Latin) letters. Mix natural Hindi and English. Never use Devanagari.",
            0.98
        );
    }

    // Gujarati input: understand Gujarati, but reply in English.
    if (gujaratiCount > 0) {
        return createResult(
            "english",
            "Gujarati",
            "Reply ONLY in English. Understand the Gujarati message fully, but do not reply in Gujarati.",
            0.98
        );
    }

    // Any other native script: English output.
    if (otherCount > 0) {
        return createResult(
            "english",
            "Other language",
            "Reply ONLY in English. Understand the user's original language and intent before answering.",
            0.95
        );
    }

    // Detect Roman Hindi / Hinglish.
    const romanLanguage = getRomanLanguage(cleaned);

    if (romanLanguage === "hinglish") {
        return createResult(
            "hinglish",
            "Hinglish",
            "Reply ONLY in Hinglish using Roman (Latin) letters. Mix natural Hindi and English. Never use Devanagari.",
            0.90
        );
    }

    return createResult(
        "english",
        "English",
        "Reply ONLY in English. Use natural, clear English.",
        0.95
    );
}

/**
 * Explicit language requests are intentionally not allowed
 * to override the two-language output policy.
 *
 * Kept as an exported helper for backward compatibility.
 */
function detectExplicitLanguageRequest(text) {
    const cleaned = cleanMessage(text);

    const match = cleaned.match(
        /\b(?:reply|respond|answer|speak|talk|write)\s+in\s+(english|hinglish|hindi|gujarati|spanish|french|german)\b/i
    );

    if (!match) return null;

    return {
        requested: match[1].toLowerCase(),
        allowed: ["english", "hinglish"].includes(
            match[1].toLowerCase()
        ),
    };
}

/**
 * Every message is detected independently.
 * Older conversation language never overrides the latest message.
 */
function resolveLanguage(message, history = []) {
    const detected = detectLanguage(message);

    return {
        detected,
        explicit: detectExplicitLanguageRequest(message),
        sticky: false,
        directive: detected.directive,
    };
}

module.exports = {
    detectLanguage,
    detectExplicitLanguageRequest,
    resolveLanguage,
};
