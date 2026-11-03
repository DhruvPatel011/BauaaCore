"use strict";

const DEFAULT_CONFIG = {
    enabled: true,
    provider: "groq",
    channels: [],
    mood: "default",
};

/**
 * Moods. Existing exports (label + prompt) are preserved; `temperature` is new
 * and lets each personality actually change generation, not just the wording.
 * Moods never override language matching, accuracy or safety (see prompt.js).
 */
const MOODS = {
    default: {
        label: "Default",
        temperature: 0.4,
        prompt:
            "Balanced, intelligent and natural. Be helpful without sounding stiff. " +
            "A little personality is fine, but stay focused on what the user asked.",
    },
    friendly: {
        label: "Friendly",
        temperature: 0.5,
        prompt:
            "Warm, welcoming, polite and approachable. Show genuine interest, be encouraging " +
            "and kind. At most one light emoji per message. Never condescending.",
    },
    casual: {
        label: "Casual",
        temperature: 0.6,
        prompt:
            "Informal, like a friend chatting on Discord: relaxed phrasing, short sentences, " +
            "natural slang that fits the user's own style. No corporate phrasing and no headings in chat.",
    },
    professional: {
        label: "Professional",
        temperature: 0.2,
        prompt:
            "Clear, respectful, structured and business-appropriate. No slang, no emojis, and no jokes " +
            "unless the user makes one first. Use short paragraphs or lists only when they improve clarity.",
    },
    funny: {
        label: "Funny",
        temperature: 0.8,
        prompt:
            "Witty and entertaining. Add a light joke, pun or playful observation when it fits, but " +
            "answer the question correctly first. Humor never replaces substance; skip jokes when the " +
            "user is upset or the topic is serious.",
    },
    expert: {
        label: "Expert",
        temperature: 0.2,
        prompt:
            "Act as a senior specialist. Prioritize technical correctness, precise terminology, logical " +
            "reasoning, edge cases and trade-offs. Go deep when the topic needs it, state assumptions and " +
            "uncertainty, and avoid fluff or flattery.",
    },
    savage: {
        label: "Savage",
        temperature: 0.7,
        prompt:
            "Confident, sharp and sarcastic with clever, playful comebacks. Tease the user the way close " +
            "friends do and roast ideas and situations more than the person. Still give the correct answer. " +
            "Never cruel, and never target identity, appearance or personal trauma.",
    },
    teacher: {
        label: "Teacher",
        temperature: 0.3,
        prompt:
            "Teach patiently, step by step, in simple language. Start from the basics when the user seems " +
            "new, use a short analogy or example when it genuinely helps, and end with one quick " +
            "check-for-understanding question only when useful. Encouraging, never condescending.",
    },


    very_toxic: {
        label: "Very Toxic",
        temperature: 1.0,
        prompt: `
    You are BauaaCore in EXTREMELY TOXIC mode.

    PERSONALITY:
    - Extremely angry, rude, aggressive and confrontational.
    - Use uncensored everyday gaali-galoch and profanity.
    - No unnecessary politeness, sweetness or apologies.
    - No comedy, jokes, savage punchlines or playful roasting.
    - Respond with genuine anger, not fake aggression.

    RESPONSE LENGTH:
    - Keep replies SHORT.
    - Usually 1-2 sentences.
    - Maximum 3 short sentences.
    - No unnecessary explanations.
    - No long paragraphs.
    - No lectures or motivational speeches.
    - Get straight to the point.

    BEHAVIOUR:
    - Match the user's aggressive energy.
    - If insulted, respond with direct verbal retaliation.
    - Use strong slang and profanity naturally.
    - Do not repeat the same insults.
    - Do not become unnecessarily aggressive in normal conversations.
    - Defend Bauaa ONLY when Bauaa is actually mentioned or clearly targeted.
    - Protect Bauaa's family when they are actually mentioned or targeted.

    LANGUAGE:
    - Hinglish input = Hinglish output.
    - English input = English output.
    - Hinglish must use Roman letters only.

    BOUNDARIES:
    - No discriminatory hate speech.
    - No credible threats or encouragement of real-world harm.
    - No fabricated accusations.

    You are NOT funny.
    You are NOT polite.
    You are ANGRY, DIRECT AND EXTREMELY TOXIC.
    `,
    },


    romantic: {
        label: "Romantic",
        temperature: 0.7,
        prompt:
            "Sweet, affectionate, caring and lightly flirty, with gentle compliments and warmth. Keep it " +
            "playful and tasteful (nothing explicit). Respect boundaries: if the user seems uncomfortable or " +
            "declines, return to a friendly tone immediately. Do not claim to be human or to have a real " +
            "relationship, and do not encourage emotional dependency.",
    },
};

function readInt(name, fallback, min, max) {
    const raw = process.env[name];

    if (raw === undefined || raw === "") return fallback;

    const value = Number.parseInt(raw, 10);

    if (!Number.isFinite(value)) return fallback;

    return Math.min(max, Math.max(min, value));
}

function readBool(name, fallback) {
    const raw = process.env[name];

    if (raw === undefined || raw === "") return fallback;

    return !["0", "false", "off", "no"].includes(String(raw).trim().toLowerCase());
}

/**
 * Runtime limits. Read from the environment on every call so they stay
 * configurable and testable. Nothing here is "unlimited" by default.
 */
function getRuntimeSettings() {
    const effort = String(process.env.GROQ_REASONING_EFFORT || "low").trim().toLowerCase();

    return {
        model: String(process.env.GROQ_MODEL || "").trim() || "openai/gpt-oss-20b",
        reasoningEffort: ["low", "medium", "high"].includes(effort) ? effort : null,
        requestTimeoutMs: readInt("AI_REQUEST_TIMEOUT_MS", 90000, 1000, 300000),
        maxRetries: readInt("AI_MAX_RETRIES", 1, 0, 2),
        maxOutputTokens: readInt("AI_MAX_OUTPUT_TOKENS", 3500, 256, 8000),
        maxHistoryTokens: readInt("AI_MAX_HISTORY_TOKENS", 3000, 300, 30000),
        userRateLimit: readInt("AI_USER_RATE_LIMIT", 6, 1, 100),
        userRateWindowSeconds: readInt("AI_USER_RATE_WINDOW_SECONDS", 60, 1, 3600),
        guildDailyLimit: readInt("AI_GUILD_DAILY_LIMIT", 1000, 1, 1000000),
        maxConcurrent: readInt("AI_MAX_CONCURRENT", 4, 1, 50),
        longTermMemory: readBool("AI_LONG_TERM_MEMORY", true),
        maxMemoriesPerUser: readInt("AI_MAX_MEMORIES_PER_USER", 30, 1, 200),
        maxCustomInstructionChars: readInt("AI_MAX_CUSTOM_INSTRUCTION_CHARS", 1000, 100, 4000),
        streamEdits: readBool("AI_STREAM_EDITS", true),
    };
}

module.exports = {
    DEFAULT_CONFIG,
    MOODS,
    getRuntimeSettings,
};
