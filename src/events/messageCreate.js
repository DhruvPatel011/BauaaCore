
const { getAIConfig } = require("../ai/aiConfigManager");

const {
    getConversation,
    saveConversation,
} = require("../ai/conversationManager");

const { generateAIResponse } = require("../ai/geminiClient");
const { buildSystemPrompt } = require("../ai/prompt");

const cooldowns = new Map();

const COOLDOWN_TIME = 5000;
const MAX_MESSAGE_LENGTH = 1900;

function splitMessage(text, maxLength = MAX_MESSAGE_LENGTH) {
    const chunks = [];
    let remaining = text.trim();

    while (remaining.length > maxLength) {
        let splitAt = remaining.lastIndexOf("\n", maxLength);

        if (splitAt < maxLength * 0.5) {
            splitAt = remaining.lastIndexOf(" ", maxLength);
        }

        if (splitAt < maxLength * 0.5) {
            splitAt = maxLength;
        }

        chunks.push(remaining.slice(0, splitAt).trim());
        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining.length > 0) {
        chunks.push(remaining);
    }

    return chunks;
}

function getCooldownKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function isOnCooldown(guildId, userId) {
    const key = getCooldownKey(guildId, userId);
    const lastMessage = cooldowns.get(key);

    if (!lastMessage) {
        return false;
    }

    const elapsed = Date.now() - lastMessage;

    if (elapsed >= COOLDOWN_TIME) {
        cooldowns.delete(key);
        return false;
    }

    return true;
}

function setCooldown(guildId, userId) {
    cooldowns.set(
        getCooldownKey(guildId, userId),
        Date.now()
    );
}

module.exports = {
    name: "messageCreate",

    async execute(message) {
        if (!message.guild || message.author.bot || message.webhookId) {
            return;
        }

        const userMessage = message.content.trim();

        if (!userMessage) {
            return;
        }

        try {
            const config = await getAIConfig(message.guild.id);

            if (!config.enabled) {
                return;
            }

            if (!config.channels.includes(message.channel.id)) {
                return;
            }

            if (isOnCooldown(message.guild.id, message.author.id)) {
                return;
            }

            setCooldown(message.guild.id, message.author.id);

            console.log(
                `💬 AI Message | Server: ${message.guild.name} | User: ${message.author.tag}`
            );

            await message.channel.sendTyping();

            const history = getConversation(
                message.guild.id,
                message.author.id
            );

            const systemPrompt = buildSystemPrompt(config.mood);

            const aiResponse = await generateAIResponse({
                history,
                message: userMessage,
                systemPrompt,
            });

            if (!aiResponse || !aiResponse.trim()) {
                throw new Error("AI returned an empty response.");
            }

            saveConversation(
                message.guild.id,
                message.author.id,
                userMessage,
                aiResponse
            );

            const chunks = splitMessage(aiResponse);

            if (chunks.length > 0) {
                await message.reply({
                    content: chunks[0],
                    allowedMentions: {
                        repliedUser: false,
                        parse: [],
                    },
                });
            }

            for (let i = 1; i < chunks.length; i++) {
                await message.channel.send({
                    content: chunks[i],
                    allowedMentions: {
                        parse: [],
                    },
                });
            }

            console.log(
                `✅ AI Reply Sent | User: ${message.author.tag} | Chunks: ${chunks.length}`
            );

        } catch (error) {
            console.error("❌ AI Message Handler Error:", {
                name: error.name,
                message: error.message,
                status: error.status || error.code || "Unknown",
            });

            try {
                await message.reply({
                    content: "⚠️ AI response generate nahi ho paya. Please thodi der baad try karo.",
                    allowedMentions: {
                        repliedUser: false,
                        parse: [],
                    },
                });
            } catch (replyError) {
                console.error(
                    "❌ AI Error Reply Failed:",
                    replyError.message
                );
            }
        }
    },
};
