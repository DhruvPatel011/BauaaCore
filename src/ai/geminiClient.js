"use strict";

// NOTE: filename kept as geminiClient.js for backward compatibility; this is the Groq client.

const Groq = require("groq-sdk");
const { getRuntimeSettings } = require("./aiConfig");
const { createAIError, describeError } = require("./aiErrors");

let groqClient = null;

function getGroqClient() {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey || !apiKey.trim()) {
        throw createAIError("MISSING_GROQ_API_KEY", "GROQ_API_KEY is missing.");
    }

    if (!groqClient) {
        groqClient = new Groq({
            apiKey: apiKey.trim(),
            timeout: 60000,
            maxRetries: 0, // retries are handled explicitly below (bounded)
        });

        console.log("Groq AI Client Initialized Successfully!");
    }

    return groqClient;
}

/** Accepts both Gemini-style {role, parts:[{text}]} and OpenAI-style {role, content}. */
function normalizeHistory(history = []) {
    if (!Array.isArray(history)) return [];

    const normalized = [];

    for (const item of history) {
        if (!item) continue;

        const content = typeof item.content === "string"
            ? item.content
            : Array.isArray(item.parts)
                ? item.parts.map(part => (typeof part?.text === "string" ? part.text : "")).join("")
                : "";

        const text = content.trim();

        if (!text) continue;

        const role = item.role === "model" || item.role === "assistant" ? "assistant" : "user";
        const previous = normalized[normalized.length - 1];

        // Skip exact consecutive duplicates (e.g. a retried save).
        if (previous && previous.role === role && previous.content === text) continue;

        normalized.push({ role, content: text });
    }

    return normalized;
}

function makeAbortError() {
    const error = new Error("AI request cancelled.");
    error.name = "AbortError";
    error.code = "REQUEST_CANCELLED";
    return error;
}

function isAbortLike(error) {
    return (
        error?.name === "AbortError" ||
        error?.code === "ABORT_ERR" ||
        error?.constructor?.name === "APIUserAbortError"
    );
}

function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(makeAbortError());

        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        function onAbort() {
            clearTimeout(timer);
            reject(makeAbortError());
        }

        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/** Convert any SDK/network failure into a typed AI error. Returns { error, retryable }. */
function classifyError(error, { timedOut }) {
    if (timedOut) {
        return { error: createAIError("GROQ_TIMEOUT", "Groq request timed out."), retryable: true };
    }

    const status = Number(error?.status || 0);
    const message = String(error?.message || "");
    const retryAfterHeader = error?.headers?.["retry-after"] ?? error?.headers?.get?.("retry-after");
    const retryAfterSeconds = Number(retryAfterHeader) || 0;

    if (status === 429) {
        return {
            error: createAIError("GROQ_RATE_LIMIT", "Groq rate limit reached.", { status, retryAfterSeconds }),
            retryable: false,
        };
    }

    if (status === 401 || status === 403) {
        return { error: createAIError("GROQ_AUTH_ERROR", "Groq authentication failed.", { status }), retryable: false };
    }

    if (status === 413 || (status === 400 && /context|too (?:large|long)|maximum/i.test(message))) {
        return { error: createAIError("GROQ_CONTEXT_TOO_LARGE", "Groq request too large.", { status }), retryable: false };
    }

    if (status === 404 || (status === 400 && /model/i.test(message))) {
        return { error: createAIError("GROQ_MODEL_ERROR", "Groq model unavailable.", { status }), retryable: false };
    }

    if (status === 400 || status === 422) {
        return { error: createAIError("GROQ_BAD_REQUEST", "Groq rejected the request.", { status }), retryable: false };
    }

    if (status >= 500) {
        return { error: createAIError("GROQ_SERVER_ERROR", "Groq service unavailable.", { status }), retryable: true };
    }

    if (
        error?.constructor?.name === "APIConnectionTimeoutError" ||
        error?.constructor?.name === "APIConnectionError" ||
        /ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|fetch failed|network|socket/i.test(message)
    ) {
        return { error: createAIError("GROQ_NETWORK_ERROR", "Network error contacting Groq."), retryable: true };
    }

    return { error, retryable: false };
}

/**
 * Stream a completion from Groq.
 *
 * @param {object}   options
 * @param {Array}    options.history       Gemini-style or OpenAI-style history
 * @param {string}   options.message       Latest user message
 * @param {string}   options.systemPrompt  Built by prompt.js
 * @param {Function} [options.onText]      Called with the full text so far on every chunk
 * @param {AbortSignal} [options.signal]   Cancels the request
 * @param {number}   [options.maxTokens]   Output limit for this request
 * @param {number}   [options.temperature] Sampling temperature
 * @param {object}   [options.meta]        Filled with { finishReason, model, attempts, usage }
 * @returns {Promise<string>} the full response text
 */
async function generateAIResponseStream({
    history = [],
    message,
    systemPrompt,
    onText,
    signal,
    maxTokens,
    temperature,
    meta,
}) {
    if (!message || typeof message !== "string" || !message.trim()) {
        throw new Error("A valid user message is required.");
    }

    if (signal?.aborted) throw makeAbortError();

    const settings = getRuntimeSettings();
    const client = getGroqClient();
    const model = settings.model;

    const messages = [
        {
            role: "system",
            content: systemPrompt ||
                "You are BauaaCore. Match the latest user's language and writing style. Answer only what is asked, concisely.",
        },
        ...normalizeHistory(history),
        { role: "user", content: message.trim() },
    ];

    const body = {
        model,
        messages,
        temperature: typeof temperature === "number" ? temperature : 0.4,
        max_completion_tokens: Math.min(
            settings.maxOutputTokens,
            Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : settings.maxOutputTokens
        ),
        stream: true,
    };

    // gpt-oss models spend tokens "thinking"; keep that small so answers are not cut off.
    if (settings.reasoningEffort && /gpt-oss/i.test(model)) {
        body.reasoning_effort = settings.reasoningEffort;
        body.include_reasoning = false;
    }

    const maxAttempts = 1 + settings.maxRetries;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const onExternalAbort = () => controller.abort();
        let timedOut = false;
        let emitted = false;

        signal?.addEventListener("abort", onExternalAbort, { once: true });

        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, settings.requestTimeoutMs);

        try {
            console.log(`Groq Request | Model: ${model} | Attempt: ${attempt}/${maxAttempts}`);

            const stream = await client.chat.completions.create(body, { signal: controller.signal });

            let fullResponse = "";
            let finishReason = null;
            let usage = null;

            for await (const chunk of stream) {
                if (signal?.aborted) throw makeAbortError();

                const choice = chunk.choices?.[0];
                const content = choice?.delta?.content;

                if (choice?.finish_reason) finishReason = choice.finish_reason;
                if (chunk.x_groq?.usage) usage = chunk.x_groq.usage;
                if (chunk.usage) usage = chunk.usage;

                if (typeof content !== "string" || !content) continue;

                emitted = true;
                fullResponse += content;

                if (typeof onText === "function") {
                    await onText(fullResponse);
                }
            }

            if (!fullResponse.trim()) {
                throw createAIError("GROQ_EMPTY_RESPONSE", "Groq returned an empty response.");
            }

            if (meta && typeof meta === "object") {
                Object.assign(meta, { finishReason, model, attempts: attempt, usage });
            }

            console.log("Groq Response Generated Successfully!");

            return fullResponse.trim();

        } catch (error) {
            if (signal?.aborted) throw makeAbortError();

            if (!timedOut && (isAbortLike(error) || error?.code === "REQUEST_CANCELLED")) {
                throw makeAbortError();
            }

            if (error?.code === "GROQ_EMPTY_RESPONSE") throw error;

            const { error: typed, retryable } = classifyError(error, { timedOut });

            console.error("Groq API Error:", describeError(typed));

            // One bounded retry, and only if nothing was streamed to the user yet.
            if (retryable && !emitted && attempt < maxAttempts) {
                await sleep(800 * attempt, signal);
                continue;
            }

            throw typed;

        } finally {
            clearTimeout(timer);
            signal?.removeEventListener("abort", onExternalAbort);
        }
    }

    throw createAIError("GROQ_SERVER_ERROR", "Groq request failed.");
}

module.exports = {
    getGroqClient,
    getGeminiClient: getGroqClient,
    generateAIResponseStream,
    normalizeHistory,
};
