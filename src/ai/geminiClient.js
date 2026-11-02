
const Groq = require("groq-sdk");

let groqClient = null;

function getGroqClient() {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey || !apiKey.trim()) {
        const error = new Error("GROQ_API_KEY is missing.");
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

function normalizeHistory(history = []) {
    if (!Array.isArray(history)) return [];

    return history
        .filter(item => item && Array.isArray(item.parts))
        .map(item => ({
            role: item.role === "model" || item.role === "assistant"
                ? "assistant"
                : "user",
            content: item.parts
                .map(part => typeof part?.text === "string" ? part.text : "")
                .join("")
                .trim(),
        }))
        .filter(item => item.content.length > 0);
}

function makeAbortError() {
    const error = new Error("AI request cancelled.");
    error.name = "AbortError";
    error.code = "REQUEST_CANCELLED";
    return error;
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
            content: systemPrompt ||
                "You are BauaaCore. Match the latest user's language and writing style. Answer only what is asked, concisely.",
        },
        ...normalizeHistory(history),
        {
            role: "user",
            content: message.trim(),
        },
    ];

    try {
        console.log(`Groq Request | Model: ${model}`);

        const stream = await client.chat.completions.create(
            {
                model,
                messages,
                temperature: 0.3,
                max_completion_tokens: 1024,
                stream: true,
            },
            { signal }
        );

        let fullResponse = "";

        for await (const chunk of stream) {
            if (signal?.aborted) throw makeAbortError();

            const content = chunk.choices?.[0]?.delta?.content;

            if (typeof content !== "string" || !content) continue;

            fullResponse += content;

            if (typeof onText === "function") {
                await onText(fullResponse);
            }
        }

        if (!fullResponse.trim()) {
            throw new Error("Groq returned an empty response.");
        }

        console.log("Groq Response Generated Successfully!");

        return fullResponse.trim();

    } catch (error) {
        if (
            signal?.aborted ||
            error?.name === "AbortError" ||
            error?.code === "ABORT_ERR"
        ) {
            throw makeAbortError();
        }

        const status = Number(error?.status || 0);

        console.error("Groq API Error:", {
            status: status || "Unknown",
            code: error?.code || "UNKNOWN",
            message: String(error?.message || "Unknown error").slice(0, 1000),
        });

        if (status === 429) {
            const quotaError = new Error(
                "AI is currently busy or its free-tier quota has been reached. Please try again later."
            );
            quotaError.code = "GROQ_RATE_LIMIT";
            quotaError.status = 429;
            throw quotaError;
        }

        if (status === 401 || status === 403) {
            const authError = new Error(
                "Groq API authentication failed. Check the API key."
            );
            authError.code = "GROQ_AUTH_ERROR";
            authError.status = status;
            throw authError;
        }

        if (status >= 500) {
            const serverError = new Error(
                "Groq service is temporarily unavailable."
            );
            serverError.code = "GROQ_SERVER_ERROR";
            serverError.status = status;
            throw serverError;
        }

        throw error;
    }
}

module.exports = {
    getGroqClient,
    getGeminiClient: getGroqClient,
    generateAIResponseStream,
};
