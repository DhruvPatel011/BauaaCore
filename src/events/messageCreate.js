
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

// Active requests: one request per user per server.
const activeRequests = new Map();

const MAX_MESSAGE_LENGTH = 12000;
const MAX_DISCORD_MESSAGE_LENGTH = 1900;

// --------------------------------------------------
// REQUEST HELPERS
// --------------------------------------------------

function getRequestKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function isCurrentRequest(requestKey, request) {
    return activeRequests.get(requestKey) === request;
}

function safeErrorLog(error) {
    console.error("AI Message Handler Error:", {
        name: error?.name || "Error",
        code: error?.code || "Unknown",
        status: error?.status || "Unknown",
        message: String(error?.message || "Unknown error").slice(0, 1500),
    });
}

async function safeDelete(message) {
    try {
        if (message?.deletable) {
            await message.delete();
        }
    } catch {
        // Ignore Discord deletion errors.
    }
}

async function safeEdit(message, content) {
    try {
        if (message?.editable) {
            return await message.edit({
                content,
                allowedMentions: {
                    parse: [],
                },
            });
        }
    } catch (error) {
        console.error("AI Reply Edit Error:", error.message);
    }

    return null;
}

// --------------------------------------------------
// DISCORD MESSAGE CHUNKING
// --------------------------------------------------

function splitMessage(content, maxLength = MAX_DISCORD_MESSAGE_LENGTH) {
    const chunks = [];
    let remaining = String(content || "").trim();

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

    if (remaining) {
        chunks.push(remaining);
    }

    return chunks;
}

async function sendAIResponse(replyMessage, channel, response, requestKey, request) {
    const chunks = splitMessage(response);

    if (!chunks.length) {
        await safeEdit(replyMessage, "I couldn't generate a response. Please try again.");
        return;
    }

    if (!isCurrentRequest(requestKey, request)) return;

    // Edit the original Thinking message.
    const firstChunk = await safeEdit(replyMessage, chunks[0]);

    if (!firstChunk) {
        await safeDelete(replyMessage);

        if (!isCurrentRequest(requestKey, request)) return;

        await channel.send({
            content: chunks[0],
            allowedMentions: { parse: [] },
        });
    }

    // Send remaining chunks separately.
    for (let i = 1; i < chunks.length; i++) {
        if (!isCurrentRequest(requestKey, request)) return;

        await channel.send({
            content: chunks[i],
            allowedMentions: { parse: [] },
        });
    }
}

// --------------------------------------------------
// ERROR MESSAGES
// --------------------------------------------------

function getFriendlyError(error) {
    if (error?.code === "MISSING_GROQ_API_KEY") {
        return "AI configuration error. Please contact a server administrator.";
    }

    if (
        error?.code === "GROQ_RATE_LIMIT" ||
        Number(error?.status) === 429
    ) {
        return "AI is currently busy or its free-tier quota has been reached. Please try again later.";
    }

    if (
        error?.code === "GROQ_AUTH_ERROR" ||
        Number(error?.status) === 401 ||
        Number(error?.status) === 403
    ) {
        return "AI authentication failed. Please contact a server administrator.";
    }

    if (
        error?.code === "GROQ_SERVER_ERROR" ||
        Number(error?.status) >= 500
    ) {
        return "AI service is temporarily unavailable. Please try again later.";
    }

    return "Something went wrong while generating the AI response. Please try again.";
}

// --------------------------------------------------
// MAIN AI PROCESSOR
// --------------------------------------------------

async function processAIMessage({
    message,
    replyMessage,
    userMessage,
    request,
    requestKey,
}) {
    let typingInterval = null;

    try {
        if (!isCurrentRequest(requestKey, request)) return;

        // Fetch the latest server AI configuration.
        const config = await getAIConfig(message.guild.id);

        if (!isCurrentRequest(requestKey, request)) return;

        if (!config.enabled) {
            await safeEdit(replyMessage, "AI is currently disabled on this server.");
            return;
        }

        // Get the user's temporary conversation history.
        const history = getConversation(
            message.guild.id,
            message.author.id
        );

        // Get current server mood and multilingual instructions.
        const systemPrompt = buildSystemPrompt(config.mood);

        // Start Discord typing indicator.
        await message.channel.sendTyping();

        // Refresh typing while generation is in progress.
        typingInterval = setInterval(() => {
            if (
                isCurrentRequest(requestKey, request) &&
                !request.controller.signal.aborted
            ) {
                message.channel.sendTyping().catch(() => {});
            }
        }, 8000);

        console.log(
            `AI Processing | Server: ${message.guild.name} | User: ${message.author.username} | Mood: ${config.mood || "default"}`
        );

        // Generate AI response through Groq.
        const response = await generateAIResponseStream({
            history,
            message: userMessage,
            systemPrompt,
            signal: request.controller.signal,
        });

        if (!isCurrentRequest(requestKey, request)) return;

        if (request.controller.signal.aborted) return;

        // Save conversation only after successful generation.
        saveConversation(
            message.guild.id,
            message.author.id,
            userMessage,
            response
        );

        // Send final response in Discord.
        await sendAIResponse(
            replyMessage,
            message.channel,
            response,
            requestKey,
            request
        );

    } catch (error) {
        if (
            request.controller.signal.aborted ||
            error?.name === "AbortError" ||
            error?.code === "REQUEST_CANCELLED"
        ) {
            console.log(
                `AI Request Cancelled | User: ${message.author.username}`
            );

            await safeDelete(replyMessage);
            return;
        }

        safeErrorLog(error);

        if (!isCurrentRequest(requestKey, request)) return;

        await safeEdit(
            replyMessage,
            getFriendlyError(error)
        );

    } finally {
        if (typingInterval) {
            clearInterval(typingInterval);
        }

        // Only remove this request if it is still the current one.
        if (isCurrentRequest(requestKey, request)) {
            activeRequests.delete(requestKey);
        }
    }
}

// --------------------------------------------------
// DISCORD MESSAGE CREATE EVENT
// --------------------------------------------------

module.exports = {
    name: "messageCreate",

    async execute(message) {
        try {
            // Ignore DMs, bots, webhooks and invalid messages.
            if (!message.guild) return;
            if (!message.author || message.author.bot) return;
            if (message.webhookId) return;
            if (!message.content || !message.content.trim()) return;

            const userMessage = message.content.trim();

            // Prevent excessively long input.
            if (userMessage.length > MAX_MESSAGE_LENGTH) {
                return message.reply({
                    content: `Your message is too long. Maximum allowed length is ${MAX_MESSAGE_LENGTH} characters.`,
                    allowedMentions: { parse: [] },
                });
            }

            // Get server AI configuration.
            const config = await getAIConfig(message.guild.id);

            if (!config || !config.enabled) return;

            // Respond only inside configured AI channels.
            if (
                !Array.isArray(config.channels) ||
                !config.channels.includes(message.channel.id)
            ) {
                return;
            }

            const requestKey = getRequestKey(
                message.guild.id,
                message.author.id
            );

            // Cancel previous request from this same user.
            const previousRequest = activeRequests.get(requestKey);

            if (previousRequest) {
                previousRequest.controller.abort();
            }

            // Create a new request.
            const request = {
                controller: new AbortController(),
            };

            activeRequests.set(requestKey, request);

            // Show Thinking message.
            const replyMessage = await message.reply({
                content: "💭 Thinking...",
                allowedMentions: { parse: [] },
            });

            // Process AI request without blocking other users.
            void processAIMessage({
                message,
                replyMessage,
                userMessage,
                request,
                requestKey,
            });

        } catch (error) {
            safeErrorLog(error);

            if (message.channel) {
                await message.channel.send({
                    content: "Something went wrong while processing your message.",
                    allowedMentions: { parse: [] },
                }).catch(() => {});
            }
        }
    },
};
