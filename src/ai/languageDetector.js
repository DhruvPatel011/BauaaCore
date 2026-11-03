"use strict";

/**
 * Lightweight, dependency-free language/script detection.
 * It does not replace the model's own judgement; it produces an explicit,
 * per-message directive that makes language matching far more reliable,
 * especially for Roman-script Hinglish / Gujarati (which scripts alone can't tell apart).
 */

const SCRIPTS = [
    { key: "devanagari", re: /[\u0900-\u097F]/g, label: "Hindi", script: "Devanagari" },
    { key: "gujarati", re: /[\u0A80-\u0AFF]/g, label: "Gujarati", script: "Gujarati" },
    { key: "gurmukhi", re: /[\u0A00-\u0A7F]/g, label: "Punjabi", script: "Gurmukhi" },
    { key: "arabic", re: /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g, label: "Urdu (or the Arabic-script language the user wrote)", script: "Arabic" },
    { key: "bengali", re: /[\u0980-\u09FF]/g, label: "Bengali", script: "Bengali" },
    { key: "tamil", re: /[\u0B80-\u0BFF]/g, label: "Tamil", script: "Tamil" },
    { key: "telugu", re: /[\u0C00-\u0C7F]/g, label: "Telugu", script: "Telugu" },
    { key: "kannada", re: /[\u0C80-\u0CFF]/g, label: "Kannada", script: "Kannada" },
    { key: "malayalam", re: /[\u0D00-\u0D7F]/g, label: "Malayalam", script: "Malayalam" },
    { key: "cyrillic", re: /[\u0400-\u04FF]/g, label: "the Cyrillic-script language the user wrote (e.g. Russian)", script: "Cyrillic" },
    { key: "greek", re: /[\u0370-\u03FF]/g, label: "Greek", script: "Greek" },
    { key: "hebrew", re: /[\u0590-\u05FF]/g, label: "Hebrew", script: "Hebrew" },
    { key: "thai", re: /[\u0E00-\u0E7F]/g, label: "Thai", script: "Thai" },
    { key: "korean", re: /[\uAC00-\uD7AF\u1100-\u11FF]/g, label: "Korean", script: "Hangul" },
    { key: "japanese", re: /[\u3040-\u30FF]/g, label: "Japanese", script: "Japanese" },
    { key: "chinese", re: /[\u4E00-\u9FFF]/g, label: "Chinese", script: "Han" },
];

// Collapse repeated letters so "haiii", "kaam", "kam" and "hai" compare consistently.
const squash = word => word.replace(/(.)\1+/g, "$1");

const HINGLISH_WORDS = new Set([
    "kya", "hai", "hain", "hoon", "nahi", "nahin", "nhi", "kaise", "kese", "kaisa", "kyu", "kyun", "kyon",
    "kab", "kahan", "kaha", "mujhe", "mujhko", "mera", "meri", "mere", "tera", "teri", "tere", "tumhara",
    "aapka", "aap", "tum", "tu", "yeh", "ye", "woh", "wo", "iska", "uska", "isko", "usko", "isse", "usse",
    "chahiye", "chahie", "accha", "acha", "achha", "theek", "thik", "abhi", "bata", "batao", "bolo", "bol",
    "karo", "karna", "kar", "kr", "kiya", "karke", "kaam", "yaar", "yar", "bhai", "kuch", "koi", "lekin",
    "magar", "aur", "haan", "han", "toh", "matlab", "kyunki", "kyuki", "wala", "wali", "rha", "rhi", "rhe",
    "raha", "rahi", "rahe", "liye", "hua", "hoga", "hogi", "sab", "sabko", "bahut", "bohot", "bhot",
    "sirf", "phir", "fir", "wahi", "wohi", "pichle", "pehle", "pahle", "jao", "aao", "chalo", "dekh",
    "dekho", "samajh", "samjha", "samjhao", "sahi", "galat", "zyada", "jyada", "thoda", "thodi", "likh",
    "likho", "likhna", "bana", "banao", "dikha", "dikhao", "scene", "haal", "mein", "ho",
].map(squash));

const GUJARATI_ROMAN_WORDS = new Set([
    "che", "chhe", "chu", "chhu", "chho", "shu", "mane", "tane", "tamne", "mara", "mari", "maru", "tara",
    "tari", "taru", "amne", "amara", "joie", "joiye", "kem", "kevu", "kevi", "kevo", "ame", "tame",
    "nathi", "saru", "saras", "ane", "thayu", "karvu", "maate", "aavjo", "hatu", "hati", "kaho", "kahevu",
    "vaat", "kyare", "ketlu", "ketla", "aave", "aavyo", "gayo", "gayu", "avu", "aavu", "cho",
].map(squash));

// Words that identify Hindi even when the Gujarati list also matches on shared words.
const SHARED_BHAI = squash("bhai");

function stripNoise(text) {
    return String(text ?? "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`[^`]*`/g, " ")
        .replace(/https?:\/\/\S+/gi, " ")
        .replace(/<a?:\w+:\d+>/g, " ")
        .replace(/<[@#&!]+\d+>/g, " ");
}

function result(key, label, script, directive, confidence = 0.8) {
    return { key, label, script, directive, confidence };
}

const ROMAN_RESULTS = {
    english: () => result("english", "English", "Latin", "Reply in English."),
    hinglish: confidence => result(
        "hinglish", "Hinglish (Roman Hindi)", "Latin",
        "Reply in Hinglish: Hindi mixed with English, written in Roman (Latin) letters, matching the user's casual style. Do NOT use Devanagari script.",
        confidence
    ),
    roman_gujarati: confidence => result(
        "roman_gujarati", "Roman Gujarati", "Latin",
        "Reply in Gujarati written in Roman (Latin) letters, like the user. Do NOT use Gujarati script.",
        confidence
    ),
};

function detectRoman(cleaned) {
    const tokens = (cleaned.toLowerCase().match(/[a-z]+/g) || []).map(squash);

    if (tokens.length === 0) return null;

    let hindi = 0;
    let gujarati = 0;

    for (const token of tokens) {
        if (GUJARATI_ROMAN_WORDS.has(token)) gujarati += 1;
        else if (HINGLISH_WORDS.has(token)) hindi += 1;
    }

    // "bhai" is common slang in English chat too; weigh it lightly via the ratio rule below.
    if (gujarati >= 2 && gujarati > hindi) return ROMAN_RESULTS.roman_gujarati(0.9);
    if (gujarati >= 1 && gujarati > hindi && tokens.length <= 3) return ROMAN_RESULTS.roman_gujarati(0.7);

    const hindiRatio = hindi / tokens.length;
    const onlyBhai = hindi === 1 && tokens.includes(SHARED_BHAI);

    if (!onlyBhai && (hindi >= 2 || (hindi >= 1 && hindiRatio >= 0.25))) {
        return ROMAN_RESULTS.hinglish(hindi >= 2 ? 0.9 : 0.7);
    }

    return ROMAN_RESULTS.english();
}

function detectLanguage(text) {
    const cleaned = stripNoise(text);
    const counts = SCRIPTS.map(entry => ({
        ...entry,
        count: (cleaned.match(entry.re) || []).length,
    }));

    // Kana implies Japanese; don't let shared Han characters win over it.
    const kana = counts.find(c => c.key === "japanese")?.count || 0;
    const adjusted = counts.map(c => (c.key === "chinese" && kana > 0 ? { ...c, count: 0 } : c));
    const top = adjusted.reduce((best, c) => (c.count > best.count ? c : best), { count: 0 });
    const latin = (cleaned.match(/[A-Za-z]/g) || []).length;

    if (top.count === 0 && latin === 0) {
        return result(
            "unknown", "Unknown", "None",
            "Match the language and script of the user's recent messages; default to English.",
            0
        );
    }

    if (top.count > latin) {
        let directive = `Reply in ${top.label} using ${top.script} script.`;

        if (top.key === "devanagari") directive = "Reply in Hindi using Devanagari script.";
        if (top.key === "gujarati") directive = "Reply in Gujarati using Gujarati script.";
        if (top.key === "arabic") {
            directive = "Reply in the same language and Arabic-script style the user wrote (typically Urdu).";
        }

        return result(top.key, top.label, top.script, directive, 0.95);
    }

    return detectRoman(cleaned) || ROMAN_RESULTS.english();
}

// --------------------------------------------------
// Explicit language requests ("reply in Hindi", "english me bolo", ...)
// --------------------------------------------------

const REQUESTABLE = [
    { key: "english", label: "English", names: "english|angrezi|angreji|इंग्लिश|अंग्रेज़ी|अंग्रेजी" },
    { key: "hinglish", label: "Hinglish", names: "hinglish" },
    { key: "hindi", label: "Hindi", names: "hindi|हिंदी|हिन्दी" },
    { key: "gujarati", label: "Gujarati", names: "gujarati|gujrati|ગુજરાતી" },
    { key: "punjabi", label: "Punjabi", names: "punjabi|ਪੰਜਾਬੀ" },
    { key: "urdu", label: "Urdu", names: "urdu|اردو" },
    { key: "marathi", label: "Marathi", names: "marathi|मराठी" },
    { key: "bengali", label: "Bengali", names: "bengali|bangla|বাংলা" },
    { key: "tamil", label: "Tamil", names: "tamil|தமிழ்" },
    { key: "telugu", label: "Telugu", names: "telugu|తెలుగు" },
    { key: "spanish", label: "Spanish", names: "spanish|español" },
    { key: "french", label: "French", names: "french|français" },
    { key: "german", label: "German", names: "german|deutsch" },
];

const NAME_BOUNDARY = (names) => `(?<![\\p{L}])(${names})(?![\\p{L}])`;
const ALL_NAMES = REQUESTABLE.map(l => l.names).join("|");

const REQUEST_PATTERNS = [
    new RegExp(
        `(?:reply|respond|answer|talk|speak|write|chat|continue|converse|explain)[^.!?\\n]{0,25}?\\s(?:in|using)\\s+(?:the\\s+)?${NAME_BOUNDARY(ALL_NAMES)}`,
        "iu"
    ),
    new RegExp(
        `${NAME_BOUNDARY(ALL_NAMES)}\\s+(?:me|mein|mai|ma|maa|m|में|मे)\\s+(?:bolo|bol|baat|baaten|vaat|vat|reply|jawab|answer|samjhao|samjha|likho|batao|bata|karo|kar|do|dena|de|batana|bolna|बोलो|बात|जवाब|बताओ|समझाओ|लिखो)`,
        "iu"
    ),
    new RegExp(`(?:^|\\s)only\\s+${NAME_BOUNDARY(ALL_NAMES)}`, "iu"),
    new RegExp(`(?:speak|reply|talk|respond)\\s+${NAME_BOUNDARY(ALL_NAMES)}`, "iu"),
];

function findRequestedLanguage(matchedName) {
    const lowered = matchedName.toLowerCase();

    return REQUESTABLE.find(entry =>
        entry.names.split("|").some(name => name.toLowerCase() === lowered)
    );
}

function detectExplicitLanguageRequest(text) {
    const cleaned = stripNoise(text);

    for (const pattern of REQUEST_PATTERNS) {
        const match = cleaned.match(pattern);

        if (!match) continue;

        const entry = findRequestedLanguage(match[1]);

        if (!entry) continue;

        let script = null;

        if (/\b(?:roman|english letters|english script|latin)\b/i.test(cleaned)) script = "roman";
        else if (/\b(?:devanagari|native script)\b|देवनागरी|હિંદી લિપિ|ગુજરાતી લિપિ|gujarati script/i.test(cleaned)) script = "native";

        if (entry.key === "hinglish") script = "roman";

        return { key: entry.key, label: entry.label, script };
    }

    return null;
}

function explicitDirective(explicit) {
    if (explicit.key === "english") {
        return "The user explicitly asked for English. Reply in English.";
    }

    if (explicit.key === "hinglish") {
        return "The user explicitly asked for Hinglish. Reply in Hindi mixed with English in Roman letters, never Devanagari.";
    }

    let scriptClause =
        "Use the same script the user is typing in (Roman letters if they type in Roman letters, otherwise the native script).";

    if (explicit.script === "roman") scriptClause = "Write it in Roman (Latin) letters, not the native script.";
    if (explicit.script === "native") scriptClause = "Write it in the language's native script.";

    return `The user explicitly asked for replies in ${explicit.label}. ${scriptClause}`;
}

function userTextsNewestFirst(history = []) {
    const texts = [];

    for (const item of history) {
        const isUser = item?.role === "user";
        const text = Array.isArray(item?.parts)
            ? item.parts.map(part => part?.text || "").join("")
            : typeof item?.content === "string" ? item.content : "";

        if (isUser && text) texts.push(text);
    }

    return texts.reverse();
}

/**
 * Decide the reply language for the current message.
 * Priority: explicit request in this message > explicit request earlier in the
 * (short-term) conversation > automatic detection of the latest message.
 */
function resolveLanguage(message, history = []) {
    const detected = detectLanguage(message);
    let explicit = detectExplicitLanguageRequest(message);
    let sticky = false;

    if (!explicit) {
        for (const earlier of userTextsNewestFirst(history)) {
            explicit = detectExplicitLanguageRequest(earlier);

            if (explicit) {
                sticky = true;
                break;
            }
        }
    }

    let directive;

    if (explicit) {
        directive =
            explicitDirective(explicit) +
            (sticky
                ? " (Requested earlier in this conversation; keep it until the user asks for something else.)"
                : " (This overrides automatic language detection.)");
    } else {
        directive = detected.directive;
    }

    return { detected, explicit, sticky, directive };
}

module.exports = {
    detectLanguage,
    detectExplicitLanguageRequest,
    resolveLanguage,
};
