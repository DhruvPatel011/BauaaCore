"use strict";

function createAIError(code, message, extra = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, extra);
    return error;
}

const FRIENDLY_MESSAGES = {
    MISSING_GROQ_API_KEY: "AI configuration error. Please contact a server administrator.",
    GROQ_AUTH_ERROR: "AI authentication failed. Please contact a server administrator.",
    GROQ_MODEL_ERROR: "The configured AI model is unavailable. Please contact a server administrator.",
    GROQ_RATE_LIMIT: "AI is currently busy or its free-tier quota has been reached. Please try again later.",
    GROQ_SERVER_ERROR: "AI service is temporarily unavailable. Please try again later.",
    GROQ_TIMEOUT: "The AI took too long to respond. Please try again.",
    GROQ_NETWORK_ERROR: "I couldn't reach the AI service right now. Please try again in a moment.",
    GROQ_CONTEXT_TOO_LARGE: "That conversation is too large for the AI right now. Try /ai-reset and ask again.",
    GROQ_BAD_REQUEST: "The AI rejected that request. Please rephrase it and try again.",
    GROQ_EMPTY_RESPONSE: "The AI returned an empty response. Please try again.",
    AI_BUSY: "The AI is handling a lot of requests right now. Please try again in a few seconds.",
    AI_GUILD_LIMIT: "This server has reached its daily AI request limit. It resets at 00:00 UTC.",
};

const DEFAULT_MESSAGE =
    "Something went wrong while generating the AI response. Please try again.";

function getFriendlyError(error) {
    const code = error?.code;
    const status = Number(error?.status || 0);

    if (code === "GROQ_RATE_LIMIT" || (!code && status === 429)) {
        const seconds = Number(error?.retryAfterSeconds || 0);

        return seconds > 0 && seconds <= 3600
            ? `${FRIENDLY_MESSAGES.GROQ_RATE_LIMIT} (Retry in about ${Math.ceil(seconds)}s.)`
            : FRIENDLY_MESSAGES.GROQ_RATE_LIMIT;
    }

    if (FRIENDLY_MESSAGES[code]) return FRIENDLY_MESSAGES[code];

    if (status === 401 || status === 403) return FRIENDLY_MESSAGES.GROQ_AUTH_ERROR;
    if (status >= 500) return FRIENDLY_MESSAGES.GROQ_SERVER_ERROR;

    return DEFAULT_MESSAGE;
}

const lastLogged = new Map();

/** Log at most once per interval per key, so a failing dependency can't flood the logs. */
function logThrottled(key, intervalMs, ...args) {
    const now = Date.now();
    const last = lastLogged.get(key) || 0;

    if (now - last < intervalMs) return false;

    lastLogged.set(key, now);
    console.error(...args);
    return true;
}

function describeError(error) {
    return {
        name: error?.name || "Error",
        code: error?.code || "Unknown",
        status: error?.status || "Unknown",
        message: String(error?.message || "Unknown error").slice(0, 500),
    };
}

module.exports = {
    createAIError,
    getFriendlyError,
    logThrottled,
    describeError,
};
