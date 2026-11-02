
let aiClient = null;

async function getGeminiClient() {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
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

        console.log("✨ Gemini Client Initialized!");
    }

    return aiClient;
}

async function generateAIResponseStream({
    history = [],
    message,
    systemPrompt,
    onText,
}) {
    const ai = await getGeminiClient();

    const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

    const chat = ai.chats.create({
        model,
        history,
        config: {
            systemInstruction: systemPrompt,
            maxOutputTokens: 1024,
        },
    });

    console.log(`🚀 Streaming Gemini Request | ${model}`);

    const stream = await chat.sendMessageStream({ message });

    let fullResponse = "";

    for await (const chunk of stream) {
        const text = chunk.text || "";

        if (!text) continue;

        fullResponse += text;

        if (typeof onText === "function") {
            await onText(fullResponse);
        }
    }

    if (!fullResponse.trim()) {
        throw new Error("Gemini returned an empty response.");
    }

    console.log("✅ Gemini Streaming Completed!");

    return fullResponse.trim();
}

module.exports = {
    generateAIResponseStream,
};
