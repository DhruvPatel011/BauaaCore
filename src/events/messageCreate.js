
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

// Discord message limit safety margin.
const MAX_MESSAGE_LENGTH = 1900;

// Maximum user input length.
const MAX_INPUT_LENGTH = 12000;

// Store active AI requests separately for each user.
const activeRequests = new Map();

// Generate unique request key.
function getRequestKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

// Check whether a request is still the latest request.
function isCurrentRequest(key, request) {
    return (
        activeRequests.get(key) === request &&
        !request.controller.signal.aborted
    );
}

// Split long AI responses into Discord-safe messages.
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

        chunks.push(
            remaining.slice(0, splitAt).trim()
        );

        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining.length > 0) {
        chunks.push(remaining);
    }

    return chunks;
}

// Safely edit the original Discord reply.
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

// Process the AI request.
async function processAIMessage({
    message,
    replyMessage,
    userMessage,
    config,
    request,
    requestKey,
}) {
    const signal = request.controller.signal;

    try {
        if (!isCurrentRequest(requestKey, request)) {
            return;
        }

        // Fetch user's conversation history.
        const history = getConversation(
            message.guild.id,
            message.author.id
        );

        // Build personality and multilingual instructions.
        const systemPrompt = buildSystemPrompt(config.mood);

        console.log(
            `🧠 AI Processing | Server: ${message.guild.name} | User: ${message.author.tag}`
        );

        // Show typing indicator while AI generates.
        await message.channel.sendTyping().catch(() => {});

        // Generate complete answer.
        // Do not send partial text to Discord.
        const aiResponse = await generateAIResponseStream({
            history,
            message: userMessage,
            systemPrompt,
            signal,
        });

        // Ignore outdated or cancelled requests.
        if (!isCurrentRequest(requestKey, request)) {
            return;
        }

        if (!aiResponse || !aiResponse.trim()) {
            throw new Error(
                "Gemini returned an empty response."
            );
        }

        // Save only completed conversations.
        saveConversation(
            message.guild.id,
            message.author.id,
            userMessage,
            aiResponse
        );

        // Split response if it exceeds Discord's limit.
        const chunks = splitMessage(aiResponse);

        if (!isCurrentRequest(requestKey, request)) {
            return;
        }

        // Display the complete final answer only once.
        const firstChunk = chunks[0] || "No response generated.";

        const editSuccess = await safeEdit(
            replyMessage,
            firstChunk
        );

        if (!editSuccess) {
            return;
        }

        // Send remaining chunks if required.
        for (let i = 1; i < chunks.length; i++) {
            if (!isCurrentRequest(requestKey, request)) {
                return;
            }

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

        if (!isCurrentRequest(requestKey, request)) {
            return;
        }

        console.error("❌ AI Message Handler Error:", {
            name: error?.name,
            message: error?.message,
            status: error?.status || error?.code || "Unknown",
        });

        // Update the placeholder with an error.
        await safeEdit(
            replyMessage,
            "⚠️ AI response generate nahi ho paya. Please try again."
        );

    } finally {
        // Remove only this request.
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

            if (!userMessage) {
                return;
            }

            // Validate input length.
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

            // Get server AI configuration.
            const config = await getAIConfig(message.guild.id);

            if (!config.enabled) {
                return;
            }

            // Only configured AI channels.
            if (!config.channels?.includes(message.channel.id)) {
                return;
            }

            const requestKey = getRequestKey(
                message.guild.id,
                message.author.id
            );

            // Cancel previous request from this user.
            const previousRequest = activeRequests.get(requestKey);

            if (previousRequest) {
                previousRequest.controller.abort();

                // Mark old placeholder as cancelled.
                if (previousRequest.replyMessage) {
                    await safeEdit(
                        previousRequest.replyMessage,
                        "⏭️ Previous response cancelled. Processing your latest message..."
                    );
                }
            }

            // Create new request controller.
            const request = {
                controller: new AbortController(),
                replyMessage: null,
            };

            activeRequests.set(requestKey, request);

            // Immediately create a reply under this message.
            const replyMessage = await message.reply({
                content: "💭 Thinking...",
                allowedMentions: {
                    repliedUser: false,
                    parse: [],
                },
            });

            request.replyMessage = replyMessage;

            // Ensure this request is still the latest.
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
                config,
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
