
let aiClient = null;

async function getGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || !apiKey.trim()) {
        throw new Error("GEMINI_API_KEY is missing.");
    }

    if (!aiClient) {
        const { GoogleGenAI } = await import("@google/genai");

        aiClient = new GoogleGenAI({
            apiKey: apiKey.trim(),
            httpOptions: {
                timeout: 60000,
            },
        });

        console.log("✨ Gemini Client Initialized Successfully!");
    }

    return aiClient;
}

function isCancelled(signal) {
    return Boolean(signal?.aborted);
}

function makeAbortError() {
    const error = new Error("Gemini request cancelled.");
    error.name = "AbortError";
    return error;
}

function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        if (isCancelled(signal)) {
            reject(makeAbortError());
            return;
        }

        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);

        function onAbort() {
            clearTimeout(timer);
            cleanup();
            reject(makeAbortError());
        }

        function cleanup() {
            signal?.removeEventListener("abort", onAbort);
        }

        signal?.addEventListener("abort", onAbort, {
            once: true,
        });
    });
}

// Detect permanent daily quota exhaustion.
function isDailyQuotaError(error) {
    const message = String(error?.message || "").toLowerCase();

    return (
        message.includes("generate_content_free_tier_requests") ||
        message.includes("free_tier_requests") ||
        (
            message.includes("quota exceeded") &&
            message.includes("free tier")
        )
    );
}

// Convert quota error into a clear application error.
function createQuotaError(originalError) {
    const error = new Error(
        "Gemini daily free-tier quota exhausted. Please wait for quota reset or upgrade the API project billing tier."
    );

    error.name = "GeminiQuotaError";
    error.code = "DAILY_QUOTA_EXHAUSTED";
    error.status = 429;
    error.originalError = originalError;

    return error;
}

// Generate response with streaming.
async function generateAIResponseStream({
    history = [],
    message,
    systemPrompt,
    onText,
    signal,
}) {
    if (!message || typeof message !== "string") {
        throw new Error("A valid user message is required.");
    }

    if (isCancelled(signal)) {
        throw makeAbortError();
    }

    const ai = await getGeminiClient();

    const model =
        process.env.GEMINI_MODEL || "gemini-flash-latest";

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (isCancelled(signal)) {
                throw makeAbortError();
            }

            console.log(
                `🚀 Gemini Request | Model: ${model} | Attempt: ${attempt}/${maxAttempts}`
            );

            const chat = ai.chats.create({
                model,
                history,
                config: {
                    systemInstruction: systemPrompt,
                    temperature: 0.8,
                    maxOutputTokens: 2048,
                    abortSignal: signal,
                },
            });

            const stream = await chat.sendMessageStream({
                message,
            });

            let fullResponse = "";

            for await (const chunk of stream) {
                if (isCancelled(signal)) {
                    throw makeAbortError();
                }

                const chunkText = chunk.text || "";

                if (!chunkText) continue;

                fullResponse += chunkText;

                // Optional streaming callback.
                // messageCreate can omit this to display only
                // the final complete answer.
                if (typeof onText === "function") {
                    await onText(fullResponse);
                }
            }

            if (!fullResponse.trim()) {
                throw new Error("Gemini returned an empty response.");
            }

            console.log("✅ Gemini Response Generated Successfully!");

            return fullResponse.trim();

        } catch (error) {
            if (
                isCancelled(signal) ||
                error?.name === "AbortError"
            ) {
                console.log("⏭️ Gemini request cancelled.");
                throw error;
            }

            const status = Number(
                error?.status || error?.code || 0
            );

            // Daily quota cannot be fixed by retrying.
            if (status === 429 && isDailyQuotaError(error)) {
                console.error(
                    "🛑 Gemini daily free-tier quota exhausted."
                );

                throw createQuotaError(error);
            }

            console.error("❌ Gemini API Error:", {
                attempt,
                status,
                name: error?.name,
                message: String(error?.message || "").slice(0, 1500),
            });

            // Retry only potentially temporary errors.
            const retryableStatuses = [
                408,
                429,
                500,
                502,
                503,
                504,
            ];

            if (
                !retryableStatuses.includes(status) ||
                attempt === maxAttempts
            ) {
                throw error;
            }

            const delay = 1000 * Math.pow(2, attempt - 1);

            console.log(
                `⏳ Temporary API error. Retrying in ${delay}ms...`
            );

            await wait(delay, signal);
        }
    }

    throw new Error("Gemini request failed.");
}

module.exports = {
    getGeminiClient,
    generateAIResponseStream,
};
