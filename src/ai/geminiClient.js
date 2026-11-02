let aiClient = null;

async function getGeminiClient() {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing from .env");
    }

    if (!aiClient) {
        const { GoogleGenAI } = await import("@google/genai");

        aiClient = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
        });
    }

    return aiClient;
}

async function generateAIResponse({
    history,
    message,
    systemPrompt,
}) {
    const ai = await getGeminiClient();

    const chat = ai.chats.create({
        model: process.env.GEMINI_MODEL || "gemini-flash-latest",
        history,
        config: {
            systemInstruction: systemPrompt,
            temperature: 0.9,
            maxOutputTokens: 2048,
        },
    });

    const response = await chat.sendMessage({
        message,
    });

    const text = response.text?.trim();

    if (!text) {
        throw new Error("Gemini returned an empty response.");
    }

    return text;
}

module.exports = { generateAIResponse };