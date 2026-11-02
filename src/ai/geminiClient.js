
let aiClient = null;

async function getGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || !apiKey.trim()) {
        throw new Error("GEMINI_API_KEY is missing from environment variables.");
    }

    if (!aiClient) {
        const { GoogleGenAI } = await import("@google/genai");

        aiClient = new GoogleGenAI({
            apiKey: apiKey.trim(),
            httpOptions: {
                timeout: 30000,
            },
        });

        console.log("✨ Gemini AI Client Initialized Successfully!");
    }

    return aiClient;
}


async function generateAIResponse({
    history = [],
    message,
    systemPrompt,
}) {
    if (!message || typeof message !== "string") {
        throw new Error("A valid user message is required.");
    }

    const ai = await getGeminiClient();
    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

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
                    maxOutputTokens: 2048,
                },
            });

            const response = await chat.sendMessage({ message });
            const aiText = response.text?.trim();

            if (!aiText) {
                throw new Error("Gemini returned an empty response.");
            }

            console.log("✅ Gemini Response Generated Successfully!");
            return aiText;

        } catch (error) {
            const status = error?.status || error?.code;

            console.error("❌ Gemini API Error:", {
                attempt,
                status,
                message: error?.message,
            });

            const retryable = [408, 429, 500, 502, 503, 504].includes(
                Number(status)
            );

            if (!retryable || attempt === maxAttempts) {
                throw error;
            }

            const delay = 1000 * Math.pow(2, attempt - 1);
            console.log(`⏳ Retrying Gemini in ${delay}ms...`);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw new Error("Gemini failed after all retry attempts.");
}


module.exports = {
    generateAIResponse,
};
