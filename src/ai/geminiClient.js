
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

    try {
        const ai = await getGeminiClient();
        const model = process.env.GEMINI_MODEL || "gemini-flash-latest";

        console.log(`🚀 Gemini Request Started | Model: ${model}`);

        const chat = ai.chats.create({
            model,
            history,
            config: {
                systemInstruction: systemPrompt,
                temperature: 0.8,
                maxOutputTokens: 2048,
            },
        });

        const response = await chat.sendMessage({
            message,
        });

        const aiText = response.text?.trim();

        if (!aiText) {
            throw new Error(
                `Empty Gemini response. Finish reason: ${
                    response.candidates?.[0]?.finishReason || "Unknown"
                }`
            );
        }

        console.log("✅ Gemini Response Generated Successfully!");

        return aiText;

    } catch (error) {
        console.error("❌ Gemini API Error:", {
            name: error?.name,
            message: error?.message,
            status: error?.status || error?.code || "Unknown",
        });

        throw error;
    }
}

module.exports = {
    generateAIResponse,
};
