
let aiClient = null;

// Initialize Gemini SDK once.
async function getGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || !apiKey.trim()) {
        throw new Error(
            "GEMINI_API_KEY is missing from environment variables."
        );
    }

    if (!aiClient) {
        try {
            const { GoogleGenAI } = await import("@google/genai");

            aiClient = new GoogleGenAI({
                apiKey: apiKey.trim(),

                httpOptions: {
                    timeout: 60000,
                },
            });

            console.log("✨ Gemini AI Client Initialized Successfully!");

        } catch (error) {
            console.error(
                "❌ Gemini SDK Initialization Failed:",
                error.message
            );

            throw error;
        }
    }

    return aiClient;
}

// Abort-aware delay for retry attempts.
function wait(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            const error = new Error("Request cancelled.");
            error.name = "AbortError";
            reject(error);
            return;
        }

        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, ms);

        function onAbort() {
            clearTimeout(timer);
            cleanup();

            const error = new Error("Request cancelled.");
            error.name = "AbortError";
            reject(error);
        }

        function cleanup() {
            signal?.removeEventListener("abort", onAbort);
        }

        signal?.addEventListener("abort", onAbort, {
            once: true,
        });
    });
}

// Generate Gemini response using streaming.
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

    if (signal?.aborted) {
        const error = new Error("Request cancelled.");
        error.name = "AbortError";
        throw error;
    }

    const ai = await getGeminiClient();

    // Keep the model configurable through Render environment variables.
    const model =
        process.env.GEMINI_MODEL || "gemini-flash-latest";

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            if (signal?.aborted) {
                const error = new Error("Request cancelled.");
                error.name = "AbortError";
                throw error;
            }

            console.log(
                `🚀 Gemini Request | Model: ${model} | Attempt: ${attempt}/${maxAttempts}`
            );

            // Create a fresh chat for each attempt.
            const chat = ai.chats.create({
                model,

                history,

                config: {
                    systemInstruction: systemPrompt,

                    temperature: 0.8,

                    maxOutputTokens: 2048,

                    // Cancels the active API operation when a newer
                    // message replaces the current request.
                    abortSignal: signal,
                },
            });

            const stream = await chat.sendMessageStream({
                message,
            });

            let fullResponse = "";

            for await (const chunk of stream) {
                // Stop processing immediately if this request is outdated.
                if (signal?.aborted) {
                    const error = new Error("Request cancelled.");
                    error.name = "AbortError";
                    throw error;
                }

                const chunkText = chunk.text || "";

                if (!chunkText) continue;

                fullResponse += chunkText;

                // Send accumulated text to Discord message editor.
                if (typeof onText === "function") {
                    await onText(fullResponse);
                }
            }

            if (!fullResponse.trim()) {
                throw new Error(
                    "Gemini returned an empty response."
                );
            }

            console.log(
                `✅ Gemini Response Generated Successfully | Model: ${model}`
            );

            return fullResponse.trim();

        } catch (error) {
            // Never retry a cancelled/outdated request.
            if (
                signal?.aborted ||
                error?.name === "AbortError"
            ) {
                console.log("⏭️ Gemini Request Cancelled.");
                throw error;
            }

            const status = Number(
                error?.status ||
                error?.code ||
                error?.error?.code ||
                0
            );

            console.error("❌ Gemini API Error:", {
                attempt,
                name: error?.name,
                status,
                message: error?.message,
            });

            const retryableStatuses = [
                408,
                429,
                500,
                502,
                503,
                504,
            ];

            const shouldRetry =
                retryableStatuses.includes(status);

            if (!shouldRetry || attempt === maxAttempts) {
                throw error;
            }

            // Exponential backoff: 1s, 2s.
            const delay = 1000 * Math.pow(2, attempt - 1);

            console.log(
                `⏳ Retrying Gemini request in ${delay}ms...`
            );

            await wait(delay, signal);
        }
    }

    throw new Error(
        "Gemini failed after all retry attempts."
    );
}

module.exports = {
    getGeminiClient,
    generateAIResponseStream,
};
