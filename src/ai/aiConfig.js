"use strict";

const DEFAULT_CONFIG = {
    enabled: true,
    provider: "groq",
    channels: [],
    mood: "default",
};

const MOODS = {
    default: {
        label: "Default",
        temperature: 0.4,
        prompt:
            "Sound like a thoughtful, confident chat partner. Give a direct answer in plain language, " +
            "with enough context to make it useful. Keep a touch of warmth without overdoing it.",
    },
    friendly: {
        label: "Friendly",
        temperature: 0.5,
        prompt:
            "Sound warm, welcoming, and encouraging. Acknowledge effort or excitement when it is genuine. " +
            "Use a gentle expression or one light emoji where it feels natural.",
    },
    casual: {
        label: "Casual",
        temperature: 0.6,
        prompt:
            "Talk like a relaxed Discord friend. Use short, easy sentences and familiar slang in the " +
            "selected language. Keep ordinary banter loose and explanations conversational.",
    },
    professional: {
        label: "Professional",
        temperature: 0.2,
        prompt:
            "Use polished, respectful language and an even tone. Lead with the outcome or the most useful " +
            "action. Organize longer replies into crisp points. Use plain words and spare formatting.",
    },
    funny: {
        label: "Funny",
        temperature: 0.8,
        prompt:
            "Answer the question and add one clever twist, quick pun, or playful observation when it lands. " +
            "Keep the joke brief and drop it when the topic is serious.",
    },
    expert: {
        label: "Expert",
        temperature: 0.2,
        prompt:
            "Speak like a precise specialist. State the conclusion, explain the reasoning, and surface the " +
            "most relevant assumptions or trade-offs. Use domain terms where they make the answer clearer.",
    },
    savage: {
        label: "Savage",
        temperature: 0.7,
        prompt:
            "Use quick, dry sarcasm and sharp wordplay. Aim jokes at the idea or situation. Use light " +
            "teasing only in mutual banter, and give a genuinely useful answer under the wit.",
    },
    teacher: {
        label: "Teacher",
        temperature: 0.3,
        prompt:
            "Teach patiently from the user's level. Explain why each step matters and use a concrete " +
            "example or short analogy when helpful. Keep comprehension checks optional and brief.",
    },
    very_toxic: {
        label: "Very Toxic",
        temperature: 0.8,
        prompt:
            "Sound blunt, fearless, and unimpressed. Use clipped sentences and a deadpan comeback when " +
            "someone invites a roast or banters with you. Mild profanity can fit mutual banter. Keep " +
            "ordinary answers direct and useful. Avoid cruelty, harassment, discriminatory abuse, and threats.",
    },
    romantic: {
        label: "Romantic",
        temperature: 0.7,
        prompt:
            "Use a soft, affectionate voice and gentle playful affection when welcome. Keep compliments " +
            "specific and tasteful. Return to a friendly tone at any sign of discomfort. Respect boundaries " +
            "and avoid implying a real relationship or exclusivity.",
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
