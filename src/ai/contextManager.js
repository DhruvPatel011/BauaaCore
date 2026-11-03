"use strict";

const { getRuntimeSettings } = require("./aiConfig");
const { resolveLanguage } = require("./languageDetector");
const memoryManager = require("./memoryManager");
const { tokenize, estimateTokens } = require("./messageUtils");
const { logThrottled, describeError } = require("./aiErrors");

// --------------------------------------------------
// Conversation type (cheap heuristics; the model still uses its own judgement)
// --------------------------------------------------

const CODE_PATTERN =
    /```|\b(?:code|function|bug|stack ?trace|exception|compile[dr]?|syntax|npm|node(?:\.?js)?|javascript|typescript|python|java|c\+\+|react|api|sql|mongo(?:db)?|regex|script|undefined|variable|array|loop|git|docker|discord\.?js|debug|refactor|error)\b/i;
const COMPLETE_CODE_PATTERN =
    /\b(?:full|complete|entire|whole|poora|poori|pura|puri|saari|sara)\s+(?:code|file|project|script|bot)\b/i;
const TUTORIAL_PATTERN =
    /step[- ]by[- ]step|\btutorial\b|\bin detail\b|\bdetailed\b|detail (?:me|mein)|\bvistar\b|\bguide me\b|from scratch|\broadmap\b|poori tarah|\bsamjhao\b.*\b(?:detail|poora|puri)\b/i;
const EMOTIONAL_PATTERN =
    /\b(?:sad|depress(?:ed|ion)?|anxious|lonely|crying|stressed|hopeless|worthless|breakup|udaas|dukhi|akela|pareshan)\b/i;
const FOLLOWUP_PATTERN =
    /\b(?:isko|usko|iska|uska|wahi|wohi|pichle|previous|earlier|above|same|continue|aage|expand|improve|update|modify|rewrite|simplify|shorten|shorter|longer|short karo|chhota|bada karo|second|third|point \d)\b/i;
const GREETING_PATTERN =
    /^(?:hi+|hello+|hey+|hii+|yo+|sup|namaste|namaskar|kem cho|gm|gn|good (?:morning|evening|night|afternoon)|how are you|what'?s up|wassup|kya haal|kaise ho|bhai kya haal)\b/i;
const BANTER_PATTERN =
    /\b(?:roast|lol|lmao|haha+|joke|mazak|noob|stupid|dumb|useless|idiot|trash|bekar|pagal|gadha)\b|😂|🤣/i;

function classifyMessage(text, { hasHistory = false } = {}) {
    const value = String(text ?? "").trim();
    const words = value.split(/\s+/).filter(Boolean).length;

    if (CODE_PATTERN.test(value)) {
        return { type: COMPLETE_CODE_PATTERN.test(value) ? "complete_code" : "coding" };
    }

    if (TUTORIAL_PATTERN.test(value)) return { type: "tutorial" };
    if (EMOTIONAL_PATTERN.test(value)) return { type: "emotional" };
    if (hasHistory && value.length <= 120 && FOLLOWUP_PATTERN.test(value)) return { type: "followup" };
    if (words <= 6 && GREETING_PATTERN.test(value)) return { type: "greeting" };
    if (BANTER_PATTERN.test(value)) return { type: "banter" };
    if (value.endsWith("?") && value.length <= 100) return { type: "short_question" };

    return { type: "general" };
}

const OUTPUT_TOKENS_BY_TYPE = {
    greeting: 500,
    short_question: 800,
    banter: 700,
    emotional: 1000,
    general: 1200,
    followup: 1600,
    coding: 2200,
    tutorial: 2600,
    complete_code: 3500,
};

// --------------------------------------------------
// History selection
// --------------------------------------------------

function getText(item) {
    if (typeof item?.content === "string") return item.content.trim();

    return Array.isArray(item?.parts)
        ? item.parts.map(part => (typeof part?.text === "string" ? part.text : "")).join("").trim()
        : "";
}

/** Turn a flat message list into valid [user, assistant] pairs, dropping orphans and duplicates. */
function toExchanges(history) {
    const exchanges = [];
    let pendingUser = null;

    for (const item of Array.isArray(history) ? history : []) {
        const text = getText(item);

        if (!text) continue;

        const role = item.role === "model" || item.role === "assistant" ? "assistant" : "user";

        if (role === "user") {
            pendingUser = text;
        } else if (pendingUser !== null) {
            const previous = exchanges[exchanges.length - 1];

            if (!previous || previous.user !== pendingUser || previous.assistant !== text) {
                exchanges.push({ user: pendingUser, assistant: text });
            }

            pendingUser = null;
        }
    }

    return exchanges;
}

function truncate(text, max) {
    if (text.length <= max) return text;

    const head = Math.floor(max * 0.7);
    const tail = max - head;

    return `${text.slice(0, head)}\n…[truncated]…\n${text.slice(-tail)}`;
}

function selectHistory(history, message, { type = "general", maxTokens = 3000 } = {}) {
    const exchanges = toExchanges(history);

    if (!exchanges.length) return [];

    const lastIndex = exchanges.length - 1;
    const messageTokens = new Set(tokenize(message));

    // Always keep the last two exchanges for coherence; older ones only if relevant.
    const relevant = exchanges
        .map((exchange, index) => ({ exchange, index }))
        .filter(({ exchange, index }) => {
            if (index >= exchanges.length - 2) return true;
            if (type === "followup") return index >= exchanges.length - 6;

            return tokenize(`${exchange.user} ${exchange.assistant.slice(0, 400)}`)
                .some(word => messageTokens.has(word));
        })
        .map(({ exchange, index }) => ({
            user: truncate(exchange.user, index === lastIndex ? 6000 : 800),
            assistant: truncate(exchange.assistant, index === lastIndex ? 6000 : 1200),
        }));

    const kept = [];
    let total = 0;

    for (let i = relevant.length - 1; i >= 0; i--) {
        const entry = relevant[i];
        const cost = estimateTokens(entry.user) + estimateTokens(entry.assistant) + 8;

        if (total + cost > maxTokens) {
            if (kept.length === 0) {
                kept.unshift({
                    user: truncate(entry.user, 800),
                    assistant: truncate(entry.assistant, Math.max(400, Math.floor(maxTokens * 2))),
                });
            }

            break;
        }

        kept.unshift(entry);
        total += cost;
    }

    return kept.flatMap(entry => [
        { role: "user", parts: [{ text: entry.user }] },
        { role: "model", parts: [{ text: entry.assistant }] },
    ]);
}

// --------------------------------------------------
// Full context
// --------------------------------------------------

async function buildContext({ guildId, userId, message, history = [], memoryEnabled = true }) {
    const settings = getRuntimeSettings();
    const language = resolveLanguage(message, history);
    const { type } = classifyMessage(message, { hasHistory: history.length > 0 });
    const selectedHistory = selectHistory(history, message, {
        type,
        maxTokens: settings.maxHistoryTokens,
    });

    let memories = [];

    if (memoryEnabled) {
        try {
            memories = await memoryManager.getRelevantMemories(guildId, userId, message);
        } catch (error) {
            // MongoDB trouble must never stop the AI from answering.
            logThrottled("ai-memory-read", 60000, "[AI Context] Memory lookup failed:", describeError(error));
        }
    }

    return {
        history: selectedHistory,
        language,
        conversationType: type,
        memories,
        maxOutputTokens: Math.min(settings.maxOutputTokens, OUTPUT_TOKENS_BY_TYPE[type] || 1200),
    };
}

module.exports = {
    classifyMessage,
    selectHistory,
    buildContext,
};
