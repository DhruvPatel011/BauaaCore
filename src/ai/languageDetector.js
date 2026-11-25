"use strict";

const DEFAULT_LANGUAGE = "hinglish";

const LANGUAGES = {
    hinglish: {
        directive: "Reply in natural Roman Hinglish. Write Hindi in Latin letters and blend in English naturally.",
        thinking: "💭 Soch rahi hoon…",
        continuation: '*(Reply ka baaki hissa reh gaya. Aage ke liye "continue, Hinglish please" likho.)*',
    },
    hindi: {
        directive: "Reply in natural Hindi using Devanagari script. Use feminine Hindi grammar for yourself.",
        thinking: "💭 सोच रही हूँ…",
        continuation: '*(जवाब अधूरा रह गया। आगे के लिए "जारी रखो, हिंदी में जवाब दो" लिखें।)*',
    },
    gujarati: {
        directive: "Reply in natural Gujarati using Gujarati script. Use Gujarati vocabulary and grammar.",
        thinking: "💭 વિચારી રહી છું…",
        continuation: '*(જવાબ અધૂરો રહી ગયો. આગળ માટે "ચાલુ રાખો, ગુજરાતીમાં જવાબ આપો" લખો.)*',
    },
    english: {
        directive: "Reply in clear, natural English.",
        thinking: "💭 Thinking…",
        continuation: '*(Response was cut off. Say "continue, reply in English" for the rest.)*',
    },
};

const ALIASES = {
    hinglish: "hinglish", हिंग्लिश: "hinglish", हिंगलिश: "hinglish", હિંગ્લિશ: "hinglish",
    hindi: "hindi", हिंदी: "hindi", हिन्दी: "hindi", હિન્દી: "hindi", હિંદી: "hindi",
    gujarati: "gujarati", gujrati: "gujarati", गुजराती: "gujarati", ગુજરાતી: "gujarati",
    english: "english", अंग्रेज़ी: "english", अंग्रेजी: "english", અંગ્રેજી: "english",
};

const NAME = `(?<language>${Object.keys(ALIASES).join("|")})`;
const REQUEST_END = "(?:\\s+(?:only|please|pls|for this (?:reply|answer)))*$";
const ONGOING_CUE = "from now on|going forward|ab se|aaj se|હવેથી|अब से";
const ONGOING = new RegExp(`^(?:${ONGOING_CUE})[\\s,:-]+`, "u");
const ONGOING_END = new RegExp(`[\\s,:-]+(?:${ONGOING_CUE})$`, "u");
const PREFIX_COMMA = new RegExp(`(${ONGOING_CUE})[ \\t]*,[ \\t]*`, "gu");
const SUFFIX_COMMA = new RegExp(`,[ \\t]*(?=(?:${ONGOING_CUE})[ \\t]*(?:[.!?;।\\n]|$))`, "gu");
const POLITE_PREFIX = /^(?:(?:zoya|please|pls|kindly)\s+)+/u;
const CLAUSE_BREAK = /[.!?;।,\n]+|\s+(?:and|aur|ane)\s+(?=(?:reply|respond|answer|speak|talk|switch)\b)/u;
const REQUEST_PATTERNS = [
    new RegExp(`^(?<ongoing>switch\\s+to|change\\s+(?:(?:the|your)\\s+)?(?:reply\\s+)?language\\s+to|(?:go\\s+)?back\\s+to)\\s+${NAME}${REQUEST_END}`, "u"),
    new RegExp(`^(?:(?:can|could|would|will)\\s+you\\s+)?(?:(?<ongoing>always|keep)\\s+)?(?:reply(?:ing)?|respond(?:ing)?|answer(?:ing)?|speak(?:ing)?|talk(?:ing)?|chat(?:ting)?|write)\\s+(?:(?:to\\s+)?me\\s+)?(?:in\\s+)?${NAME}${REQUEST_END}`, "u"),
    new RegExp(`^(?:explain|summari[sz]e|tell me)\\s+.+\\s+in\\s+${NAME}${REQUEST_END}`, "u"),
    new RegExp(`^(?:in\\s+)?${NAME}\\s+(?:please|pls|only)$`, "u"),
    new RegExp(`^${NAME}\\s+(?:mein|mai|main|me|ma|maa)\\s+(?:hi\\s+)?` +
        "(?:(?:reply|respond|answer|explain|chat|talk|speak|baat|vaat|jawab)\\s+(?:karo|kro|kar|karna|krna|do|dena|aapo|apo)|" +
        "(?:bolo|bol|batao|samjhao|samjavo|kaho|likho))(?:\\s+(?!mat\\b|nahin?\\b).*)?$", "u"),
    new RegExp(`^${NAME}\\s*(?:में|मे|માં|મા)\\s+(?:ही\\s+|જ\\s+)?` +
        "(?:बात करो|बात करें|जवाब दो|जवाब दें|बोलो|बताओ|बताइए|समझाओ|समझाइए|લખો|બોલો|વાત કરો|જવાબ આપો|સમજાવો|કહો)" +
        "(?:\\s+.*)?$", "u"),
];

function detectExplicitLanguageRequest(text) {
    const cleaned = String(text ?? "")
        .toLowerCase()
        .normalize("NFC")
        .replace(/```[\s\S]*?(?:```|$)|`[^`\n]*`/g, " ")
        .replace(/^[ \t]*>>>[\s\S]*|^[ \t]*>.*$/gm, " ")
        .replace(/“[^”]*”|"[^"\n]*"|https?:\/\/\S+|<[@#&!]+\d+>/g, " ")
        .replace(PREFIX_COMMA, "$1 ")
        .replace(SUFFIX_COMMA, " ")
        .trim();
    const clauses = cleaned.split(CLAUSE_BREAK);
    let result = null;

    for (const clause of clauses) {
        const request = clause.trim().replace(/\s+/g, " ")
            .replace(POLITE_PREFIX, "");
        const ongoing = ONGOING.test(request) || ONGOING_END.test(request);
        const command = request.replace(ONGOING, "").replace(ONGOING_END, "").trim().replace(POLITE_PREFIX, "");
        for (const pattern of REQUEST_PATTERNS) {
            const match = pattern.exec(command);
            if (match) {
                result = { language: ALIASES[match.groups.language], ongoing: ongoing || Boolean(match.groups.ongoing) };
                break;
            }
        }
    }
    return result;
}

function resolveLanguage(message, conversationLanguage) {
    const explicit = detectExplicitLanguageRequest(message);
    const key = explicit?.language || (Object.hasOwn(LANGUAGES, conversationLanguage)
        ? conversationLanguage : DEFAULT_LANGUAGE);
    return { key, explicit, ...LANGUAGES[key] };
}

module.exports = { DEFAULT_LANGUAGE, detectExplicitLanguageRequest, resolveLanguage };
