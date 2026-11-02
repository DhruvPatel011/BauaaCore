
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
const EDIT_INTERVAL = 800;

// Only the latest request for each user remains active.
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

    if (remaining) chunks.push(remaining);

    return chunks;
}

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
        console.error("Discord Edit Error:", error.message);
        return false;
    }
}

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
        if (!isCurrentRequest(requestKey, request)) return;

        // Get conversation history when processing begins.
        const history = getConversation(
            message.guild.id,
            message.author.id
        );

        const systemPrompt = buildSystemPrompt(config.mood);

        let lastEditTime = 0;

        await message.channel.sendTyping().catch(() => {});

        console.log(
            `🧠 AI Processing | User: ${message.author.tag}`
        );

        const aiResponse = await generateAIResponseStream({
            history,
            message: userMessage,
            systemPrompt,
            signal,

            onText: async (currentText) => {
                if (!isCurrentRequest(requestKey, request)) return;

                const now = Date.now();

                if (now - lastEditTime < EDIT_INTERVAL) return;

                // Avoid Discord's 2000-character message limit.
                if (currentText.length >= MAX_MESSAGE_LENGTH - 2) return;

                lastEditTime = now;

                await safeEdit(
                    replyMessage,
                    `${currentText} ▌`
                );
            },
        });

        // Do not send or save an outdated response.
        if (!isCurrentRequest(requestKey, request)) return;

        if (!aiResponse || !aiResponse.trim()) {
            throw new Error("Gemini returned an empty response.");
        }

        // Save only successfully completed responses.
        saveConversation(
            message.guild.id,
            message.author.id,
            userMessage,
            aiResponse
        );

        const chunks = splitMessage(aiResponse);

        if (!isCurrentRequest(requestKey, request)) return;

        // Finalize the original reply.
        await safeEdit(
            replyMessage,
            chunks[0] || "I couldn't generate a response."
        );

        // Send remaining chunks only while this request is current.
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
            `✅ AI Reply Completed | User: ${message.author.tag}`
        );

    } catch (error) {
        // Cancellation is expected when a newer message arrives.
        if (signal.aborted) {
            console.log(
                `⏭️ Previous AI request cancelled | User: ${message.author.tag}`
            );
            return;
        }

        if (!isCurrentRequest(requestKey, request)) return;

        console.error("❌ AI Message Error:", {
            name: error?.name,
            message: error?.message,
            status: error?.status || error?.code || "Unknown",
        });

        await safeEdit(
            replyMessage,
            "⚠️ AI response generate nahi ho paya. Please try again."
        );

    } finally {
        // Never delete a newer request's entry.
        if (activeRequests.get(requestKey) === request) {
            activeRequests.delete(requestKey);
        }
    }
}

module.exports = {
    name: "messageCreate",

    async execute(message) {
        try {
            if (
                !message.guild ||
                message.author.bot ||
                message.webhookId
            ) {
                return;
            }

            const userMessage = message.content?.trim();

            if (!userMessage) return;

            if (userMessage.length > MAX_INPUT_LENGTH) {
                await message.reply({
                    content: "⚠️ Message bahut lamba hai. Please shorten it.",
                    allowedMentions: {
                        repliedUser: false,
                        parse: [],
                    },
                });

                return;
            }

            const config = await getAIConfig(message.guild.id);

            if (!config.enabled) return;

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
                        "⏭️ Previous response cancelled — processing your latest message."
                    );
                }
            }

            // Create a fresh request.
            const request = {
                controller: new AbortController(),
                replyMessage: null,
            };

            activeRequests.set(requestKey, request);

            // Immediately create a reply under the new user message.
            const replyMessage = await message.reply({
                content: "💭 Thinking...",
                allowedMentions: {
                    repliedUser: false,
                    parse: [],
                },
            });

            request.replyMessage = replyMessage;

            // A newer message may have arrived while creating the reply.
            if (!isCurrentRequest(requestKey, request)) {
                await safeEdit(
                    replyMessage,
                    "⏭️ Cancelled — a newer message is being processed."
                );

                return;
            }

            // Start generation without blocking other incoming messages.
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
