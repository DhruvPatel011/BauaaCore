
let aiClient = null;

async function getGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey || !apiKey.trim()) {
        throw new Error("GEMINI_API_KEY is missing from .env");
    }

    if (!aiClient) {
        try {
            const { GoogleGenAI } = await import("@google/genai");

            aiClient = new GoogleGenAI({
                apiKey: apiKey.trim(),
            });

            console.log("✨ Gemini AI Client Initialized Successfully!");

        } catch (error) {
            console.error("❌ Gemini SDK Initialization Failed:", error.message);
            throw error;
        }
    }

    return aiClient;
}

function getSafeErrorDetails(error) {
    return {
        name: error?.name || "UnknownError",
        message: error?.message || "Unknown Gemini API error",
        status: error?.status || error?.code || "Unknown",
    };
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

    const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

    try {
        const chat = ai.chats.create({
            model,
            history,
            config: {
                systemInstruction: systemPrompt,
                temperature: 0.8,
                maxOutputTokens: 2048,
            },
        });

        console.log(`🧠 Gemini Request | Model: ${model}`);

        const response = await chat.sendMessage({
            message,
        });

        const text = response.text?.trim();

        if (!text) {
            const finishReason =
                response.candidates?.[0]?.finishReason || "Unknown";

            const blockReason =
                response.promptFeedback?.blockReason || "None";

            throw new Error(
                `Gemini returned an empty response. Finish reason: ${finishReason}. Block reason: ${blockReason}.`
            );
        }

        console.log("✨ Gemini Response Generated Successfully!");

        return text;

    } catch (error) {
        const details = getSafeErrorDetails(error);

        console.error("❌ Gemini API Request Failed:", details);

        throw error;
    }
}

module.exports = {
    generateAIResponse,
};
