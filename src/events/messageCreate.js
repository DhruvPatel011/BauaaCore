
const {
    getAIConfig,
} = require("../ai/aiConfigManager");

const {
    getConversation,
    saveConversation,
} = require("../ai/conversationManager");

const {
    generateAIResponse,
} = require("../ai/geminiClient");

const {
    buildSystemPrompt,
} = require("../ai/prompt");

// Per-user cooldown: 5 seconds
const cooldowns = new Map();
const COOLDOWN_TIME = 5000;

// Discord message limit is 2000 characters.
// Keep a margin for safe delivery.
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
        try {
            // Ignore DMs, bots and webhook messages.
            if (!message.guild || message.author.bot || message.webhookId) {
                return;
            }

            // Ignore empty messages.
            const userMessage = message.content.trim();

            if (!userMessage) {
                return;
            }

            // Load this server's AI configuration.
            const config = await getAIConfig(message.guild.id);

            // Check whether AI is enabled.
            if (!config.enabled) {
                return;
            }

            // Only respond in configured AI channels.
            if (!config.channels.includes(message.channel.id)) {
                return;
            }

            // Apply per-user cooldown.
            if (isOnCooldown(message.guild.id, message.author.id)) {
                return;
            }

            setCooldown(message.guild.id, message.author.id);

            // Show typing indicator.
            await message.channel.sendTyping();

            // Get the user's previous temporary conversation.
            const history = getConversation(
                message.guild.id,
                message.author.id
            );

            // Generate system prompt based on server mood.
            const systemPrompt = buildSystemPrompt(config.mood);

            // Generate response using Gemini.
            const aiResponse = await generateAIResponse({
                history,
                message: userMessage,
                systemPrompt,
            });

            if (!aiResponse || !aiResponse.trim()) {
                throw new Error("AI returned an empty response.");
            }

            // Save conversation only after successful generation.
            saveConversation(
                message.guild.id,
                message.author.id,
                userMessage,
                aiResponse
            );

            // Split long replies into Discord-safe chunks.
            const chunks = splitMessage(aiResponse);

            // Send first part as a reply.
            if (chunks.length > 0) {
                await message.reply({
                    content: chunks[0],
                    allowedMentions: {
                        repliedUser: false,
                        parse: [],
                    },
                });
            }

            // Send remaining parts separately.
            for (let i = 1; i < chunks.length; i++) {
                await message.channel.send({
                    content: chunks[i],
                    allowedMentions: {
                        parse: [],
                    },
                });
            }

        } catch (error) {
            console.error("[AI Message Handler Error]", error);

            // Avoid exposing API or database error details to users.
            try {
                await message.reply({
                    content: "Something went wrong while generating the AI response. Please try again later.",
                    allowedMentions: {
                        repliedUser: false,
                        parse: [],
                    },
                });
            } catch (replyError) {
                console.error("[AI Error Reply Failed]", replyError);
            }
        }
    },
};
