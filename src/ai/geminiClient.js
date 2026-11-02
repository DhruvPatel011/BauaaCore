
let aiClient = null;

// Initialize Gemini SDK
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

// Retry helper
function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Generate AI response with streaming
async function generateAIResponseStream({
    history = [],
    message,
    systemPrompt,
    onText,
}) {
    if (!message || typeof message !== "string") {
        throw new Error("A valid user message is required.");
    }

    const ai = await getGeminiClient();

    const model =
        process.env.GEMINI_MODEL || "gemini-3.8-flash";

    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            console.log(
                `🚀 Gemini Request | Model: ${model} | Attempt: ${attempt}/${maxAttempts}`
            );

            const chat = ai.chats.create({
                model,

                history,

                config: {
                    systemInstruction: systemPrompt,

                    thinkingConfig: {
                        thinkingLevel: "medium",
                    },

                    temperature: 0.8,

                    maxOutputTokens: 4096,
                },
            });

            const stream = await chat.sendMessageStream({
                message,
            });

            let fullResponse = "";

            for await (const chunk of stream) {
                const chunkText = chunk.text || "";

                if (!chunkText) continue;

                fullResponse += chunkText;

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
                "✅ Gemini Response Generated Successfully!"
            );

            return fullResponse.trim();

        } catch (error) {
            const status = Number(
                error?.status || error?.code || 0
            );

            console.error("❌ Gemini API Error:", {
                attempt,
                status,
                name: error?.name,
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

            const delay = 1000 * Math.pow(2, attempt - 1);

            console.log(
                `⏳ Retrying Gemini request in ${delay}ms...`
            );

            await wait(delay);
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
