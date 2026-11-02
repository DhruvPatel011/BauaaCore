
const Groq = require("groq-sdk");

let groqClient = null;

function getGroqClient() {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey || !apiKey.trim()) {
        const error = new Error("GROQ_API_KEY is missing. Add it to Render Environment Variables.");
        error.code = "MISSING_GROQ_API_KEY";
        throw error;
    }

    if (!groqClient) {
        groqClient = new Groq({
            apiKey: apiKey.trim(),
            timeout: 60000,
            maxRetries: 0,
        });

        console.log("Groq AI Client Initialized Successfully!");
    }

    return groqClient;
}

function getErrorStatus(error) {
    return Number(error?.status || error?.response?.status || 0);
}

function createProviderError(error) {
    const status = getErrorStatus(error);
    const message = String(error?.message || "Unknown Groq API error");

    const wrapped = new Error(message);
    wrapped.name = error?.name || "GroqAPIError";
    wrapped.status = status;
    wrapped.originalError = error;

    if (status === 401 || status === 403) {
        wrapped.code = "GROQ_AUTH_ERROR";
        wrapped.message = "Groq API key invalid or access denied. Check GROQ_API_KEY.";
    } else if (status === 429) {
        wrapped.code = "GROQ_RATE_LIMIT";
        wrapped.message = "Groq rate limit or free-tier quota reached. Please try again later.";
    } else if (status === 400) {
        wrapped.code = "GROQ_BAD_REQUEST";
        wrapped.message = "Groq rejected the request. Check the model and message format.";
    } else if (status >= 500) {
        wrapped.code = "GROQ_SERVER_ERROR";
        wrapped.message = "Groq service is temporarily unavailable. Please try again.";
    }

    return wrapped;
}

function makeAbortError() {
    const error = new Error("AI request cancelled.");
    error.name = "AbortError";
    error.code = "REQUEST_CANCELLED";
    return error;
}

function isAbortError(error, signal) {
    return Boolean(
        signal?.aborted ||
        error?.name === "AbortError" ||
        error?.code === "ABORT_ERR"
    );
}

function normalizeHistory(history) {
    if (!Array.isArray(history)) return [];

    return history
        .filter((item) => item && Array.isArray(item.parts))
        .map((item) => ({
            role: item.role === "model" || item.role === "assistant"
                ? "assistant"
                : "user",
            content: item.parts
                .map((part) => typeof part?.text === "string" ? part.text : "")
                .join("")
                .trim(),
        }))
        .filter((item) => item.content.length > 0);
}

async function generateAIResponseStream({
    history = [],
    message,
    systemPrompt,
    onText,
    signal,
}) {
    if (!message || typeof message !== "string" || !message.trim()) {
        throw new Error("A valid user message is required.");
    }

    if (signal?.aborted) throw makeAbortError();

    const client = getGroqClient();
    const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

    const messages = [
        {
            role: "system",
            content: systemPrompt || "You are a helpful, multilingual Discord AI assistant.",
        },
        ...normalizeHistory(history),
        {
            role: "user",
            content: message.trim(),
        },
    ];

    try {
        console.log(`Groq AI Request | Model: ${model}`);

        const stream = await client.chat.completions.create(
            {
                model,
                messages,
                temperature: 0.7,
                max_completion_tokens: 2048,
                stream: true,
            },
            {
                signal,
            }
        );

        let fullResponse = "";

        for await (const chunk of stream) {
            if (signal?.aborted) throw makeAbortError();

            const text = chunk.choices?.[0]?.delta?.content;

            if (typeof text !== "string" || !text) continue;

            fullResponse += text;

            if (typeof onText === "function") {
                await onText(fullResponse);
            }
        }

        if (!fullResponse.trim()) {
            throw new Error("Groq returned an empty response.");
        }

        console.log("Groq AI Response Generated Successfully!");

        return fullResponse.trim();

    } catch (error) {
        if (isAbortError(error, signal)) {
            throw makeAbortError();
        }

        const wrappedError = createProviderError(error);

        console.error("Groq API Error:", {
            status: wrappedError.status || "Unknown",
            code: wrappedError.code || "UNKNOWN",
            message: wrappedError.message,
        });

        throw wrappedError;
    }
}

module.exports = {
    getGroqClient,
    // Backward-compatible alias if any old file still imports this name.
    getGeminiClient: getGroqClient,
    generateAIResponseStream,
};
