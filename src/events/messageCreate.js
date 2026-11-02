
const { getAIConfig } = require("../ai/aiConfigManager");
const {
    getConversation,
    saveConversation,
} = require("../ai/conversationManager");

const {
    generateAIResponseStream,
} = require("../ai/geminiClient");

const { buildSystemPrompt } = require("../ai/prompt");

const MAX_LENGTH = 1900;
const EDIT_INTERVAL = 700;

function splitMessage(text) {
    const chunks = [];
    let remaining = text.trim();

    while (remaining.length > MAX_LENGTH) {
        let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);

        if (splitAt < MAX_LENGTH * 0.5) {
            splitAt = remaining.lastIndexOf(" ", MAX_LENGTH);
        }

        if (splitAt < MAX_LENGTH * 0.5) {
            splitAt = MAX_LENGTH;
        }

        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining) chunks.push(remaining);

    return chunks;
}

module.exports = {
    name: "messageCreate",

    async execute(message) {
        if (
            !message.guild ||
            message.author.bot ||
            message.webhookId
        ) return;

        const userMessage = message.content.trim();

        if (!userMessage) return;

        try {
            const config = await getAIConfig(message.guild.id);

            if (!config.enabled) return;

            if (!config.channels.includes(message.channel.id)) return;

            console.log(
                `💬 AI Message | ${message.guild.name} | ${message.author.tag}`
            );

            // Show the reply immediately under the user's message.
            const replyMessage = await message.reply({
                content: "✍️",
                allowedMentions: {
                    repliedUser: false,
                    parse: [],
                },
            });

            await message.channel.sendTyping().catch(() => {});

            const history = getConversation(
                message.guild.id,
                message.author.id
            );

            const systemPrompt = buildSystemPrompt(config.mood);

            let lastEdit = 0;
            let latestText = "";

            const aiResponse = await generateAIResponseStream({
                history,
                message: userMessage,
                systemPrompt,

                onText: async (currentText) => {
                    latestText = currentText;

                    const now = Date.now();

                    // Avoid Discord edit rate limits.
                    if (now - lastEdit < EDIT_INTERVAL) return;

                    // Keep streaming preview within Discord's limit.
                    if (latestText.length > MAX_LENGTH) return;

                    lastEdit = now;

                    await replyMessage.edit({
                        content: latestText + " ▌",
                        allowedMentions: { parse: [] },
                    }).catch(() => {});
                },
            });

            saveConversation(
                message.guild.id,
                message.author.id,
                userMessage,
                aiResponse
            );

            const chunks = splitMessage(aiResponse);

            // Final complete answer.
            await replyMessage.edit({
                content: chunks[0] || "I couldn't generate a response.",
                allowedMentions: { parse: [] },
            });

            // Send additional chunks if required.
            for (let i = 1; i < chunks.length; i++) {
                await message.channel.send({
                    content: chunks[i],
                    allowedMentions: { parse: [] },
                });
            }

            console.log(
                `✅ AI Reply Completed | ${message.author.tag}`
            );

        } catch (error) {
            console.error("❌ AI Message Error:", {
                name: error.name,
                message: error.message,
                status: error.status || error.code || "Unknown",
            });

            // If a placeholder exists, the catch block can be
            // extended to edit it. Otherwise send a normal error reply.
            await message.reply({
                content: "⚠️ AI abhi respond nahi kar pa raha. Please try again.",
                allowedMentions: {
                    repliedUser: false,
                    parse: [],
                },
            }).catch(() => {});
        }
    },
};
