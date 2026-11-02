
const {
    getAIConfig,
} = require("../ai/aiConfigManager");

const {
    getConversation,
    saveConversation,
} = require("../ai/conversationManager");

const {
    generateAIResponseStream,
} = require("../ai/geminiClient");

const {
    buildSystemPrompt,
} = require("../ai/prompt");

const MAX_MESSAGE_LENGTH = 1900;
const MAX_INPUT_LENGTH = 12000;

// Track the latest active request for each user/server.
const activeRequests = new Map();

function getRequestKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function isCurrentRequest(key, request) {
    return (
        activeRequests.get(key) === request &&
        !request.controller.signal.aborted
    );
}

// Split long responses to respect Discord's message limit.
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

// Safely edit the original reply.
async function safeEdit(replyMessage, content) {
    try {
        await replyMessage.edit({
            content,
            allowedMentions: {
                parse: [],
            },
        });

        return true;
    } catch (error) {
        console.error(
            "❌ Discord Message Edit Error:",
            error.message
        );

        return false;
    }
}

// Process one AI request.
async function processAIMessage({
    message,
    replyMessage,
    userMessage,
    request,
    requestKey,
}) {
    const signal = request.controller.signal;

    try {
        if (!isCurrentRequest(requestKey, request)) return;

        // Fetch the latest server configuration.
        const config = await getAIConfig(message.guild.id);

        if (!config.enabled) {
            await safeEdit(
                replyMessage,
                "⚠️ AI is currently disabled on this server."
            );
            return;
        }

        if (!config.channels?.includes(message.channel.id)) {
            await safeEdit(
                replyMessage,
                "⚠️ This channel is not configured for AI."
            );
            return;
        }

        if (!isCurrentRequest(requestKey, request)) return;

        // Get the user's conversation history.
        const history = getConversation(
            message.guild.id,
            message.author.id
        );

        // Build the current server mood and language instructions.
        const systemPrompt = buildSystemPrompt(config.mood);

        console.log(
            `🧠 AI Processing | Server: ${message.guild.name} | User: ${message.author.tag} | Mood: ${config.mood}`
        );

        // Display typing indicator.
        await message.channel.sendTyping().catch(() => {});

        // Generate the complete answer.
        // No partial response is displayed in Discord.
        const aiResponse = await generateAIResponseStream({
            history,
            message: userMessage,
            systemPrompt,
            signal,
        });

        // Ignore cancelled or outdated responses.
        if (!isCurrentRequest(requestKey, request)) return;

        if (!aiResponse || !aiResponse.trim()) {
            throw new Error("Gemini returned an empty response.");
        }

        // Save only successfully generated conversations.
        saveConversation(
            message.guild.id,
            message.author.id,
            userMessage,
            aiResponse
        );

        const chunks = splitMessage(aiResponse);

        if (!isCurrentRequest(requestKey, request)) return;

        // Send the complete final response in the original reply.
        const editSuccess = await safeEdit(
            replyMessage,
            chunks[0] || "No response generated."
        );

        if (!editSuccess) return;

        // Send additional parts if required.
        for (let i = 1; i < chunks.length; i++) {
            if (!isCurrentRequest(requestKey, request)) return;

            await message.channel.send({
                content: chunks[i],
                allowedMentions: {
                    parse: [],
                },
            });
        }

        console.log(
            `✅ AI Final Reply Sent | User: ${message.author.tag} | Parts: ${chunks.length}`
        );

    } catch (error) {
        // Cancellation is expected when a newer message arrives.
        if (
            signal.aborted ||
            error?.name === "AbortError"
        ) {
            console.log(
                `⏭️ AI Request Cancelled | User: ${message.author.tag}`
            );
            return;
        }

        if (!isCurrentRequest(requestKey, request)) return;

        console.error("❌ AI Message Handler Error:", {
            name: error?.name,
            message: error?.message,
            status: error?.status || error?.code || "Unknown",
        });

        // Handle exhausted Gemini daily quota.
        if (error?.code === "DAILY_QUOTA_EXHAUSTED") {
            await safeEdit(
                replyMessage,
                "⚠️ Gemini AI ka daily free quota complete ho gaya hai. Quota reset hone ka wait karo ya API billing upgrade karo."
            );

            return;
        }

        // Handle temporary rate limits separately.
        if (Number(error?.status || error?.code) === 429) {
            await safeEdit(
                replyMessage,
                "⚠️ Gemini API rate limit reached. Please thodi der baad try karo."
            );

            return;
        }

        // Generic error.
        await safeEdit(
            replyMessage,
            "⚠️ AI response generate nahi ho paya. Please try again."
        );

    } finally {
        // Delete only the current request.
        if (activeRequests.get(requestKey) === request) {
            activeRequests.delete(requestKey);
        }
    }
}

module.exports = {
    name: "messageCreate",

    async execute(message) {
        try {
            // Ignore DMs, bots and webhook messages.
            if (
                !message.guild ||
                message.author.bot ||
                message.webhookId
            ) {
                return;
            }

            const userMessage = message.content?.trim();

            if (!userMessage) return;

            // Validate message length.
            if (userMessage.length > MAX_INPUT_LENGTH) {
                await message.reply({
                    content:
                        "⚠️ Your message is too long. Please shorten it.",
                    allowedMentions: {
                        repliedUser: false,
                        parse: [],
                    },
                });

                return;
            }

            // Get server configuration.
            const config = await getAIConfig(message.guild.id);

            if (!config.enabled) return;

            // Respond only in configured AI channels.
            if (!config.channels?.includes(message.channel.id)) {
                return;
            }

            const requestKey = getRequestKey(
                message.guild.id,
                message.author.id
            );

            // Cancel the previous request from this user.
            const previousRequest = activeRequests.get(requestKey);

            if (previousRequest) {
                previousRequest.controller.abort();

                if (previousRequest.replyMessage) {
                    await safeEdit(
                        previousRequest.replyMessage,
                        "⏭️ Previous response cancelled. Processing your latest message..."
                    );
                }
            }

            // Create a new request.
            const request = {
                controller: new AbortController(),
                replyMessage: null,
            };

            activeRequests.set(requestKey, request);

            // Immediately create a separate reply.
            const replyMessage = await message.reply({
                content: "💭 Thinking...",
                allowedMentions: {
                    repliedUser: false,
                    parse: [],
                },
            });

            request.replyMessage = replyMessage;

            // A newer request may have arrived during reply creation.
            if (!isCurrentRequest(requestKey, request)) {
                await safeEdit(
                    replyMessage,
                    "⏭️ Cancelled. A newer message is being processed."
                );

                return;
            }

            // Start processing without blocking other users.
            void processAIMessage({
                message,
                replyMessage,
                userMessage,
                request,
                requestKey,
            });

        } catch (error) {
            console.error("❌ Message Create Error:", {
                name: error?.name,
                message: error?.message,
            });
        }
    },
};
