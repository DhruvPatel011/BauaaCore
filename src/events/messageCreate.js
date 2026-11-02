
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

// Discord message limit is 2000 characters.
// Keep a safety margin.
const MAX_MESSAGE_LENGTH = 1900;

// Minimum time between Discord message edits.
const EDIT_INTERVAL = 800;

// Maximum user input length.
const MAX_INPUT_LENGTH = 12000;

// Each user's requests are processed in order.
// Different users can still use AI simultaneously.
const userQueues = new Map();

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

        chunks.push(remaining.slice(0, splitAt).trim());

        remaining = remaining.slice(splitAt).trim();
    }

    if (remaining.length > 0) {
        chunks.push(remaining);
    }

    return chunks;
}

// Create a unique queue key for each user in each server.
function getQueueKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

// Queue requests from the same user to preserve conversation order.
function enqueueUserRequest(key, task) {
    const previousTask = userQueues.get(key) || Promise.resolve();

    const currentTask = previousTask
        .catch(() => {})
        .then(task);

    userQueues.set(key, currentTask);

    currentTask.finally(() => {
        if (userQueues.get(key) === currentTask) {
            userQueues.delete(key);
        }
    }).catch(() => {});

    return currentTask;
}

// Safely update the Discord reply.
async function safeEdit(message, content) {
    try {
        await message.edit({
            content: content || "Thinking...",
            allowedMentions: {
                parse: [],
            },
        });

        return true;
    } catch (error) {
        console.error("Discord message edit failed:", error.message);
        return false;
    }
}

// Process one AI request.
async function processAIMessage(message, replyMessage, userMessage) {
    try {
        // Fetch latest history when this request reaches the queue.
        const history = getConversation(
            message.guild.id,
            message.author.id
        );

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

        const systemPrompt = buildSystemPrompt(config.mood);

        let lastEditTime = 0;
        let latestText = "";

        // Start Discord typing indicator.
        await message.channel.sendTyping().catch(() => {});

        console.log(
            `🧠 AI Processing | Server: ${message.guild.name} | User: ${message.author.tag}`
        );

        // Generate response using Gemini streaming.
        const aiResponse = await generateAIResponseStream({
            history,
            message: userMessage,
            systemPrompt,

            onText: async (currentText) => {
                latestText = currentText;

                const now = Date.now();

                // Avoid excessive Discord API edits.
                if (now - lastEditTime < EDIT_INTERVAL) {
                    return;
                }

                lastEditTime = now;

                // Show partial response while Gemini generates.
                const preview = latestText.slice(
                    0,
                    MAX_MESSAGE_LENGTH - 2
                );

                if (preview.trim()) {
                    await safeEdit(
                        replyMessage,
                        `${preview} ▌`
                    );
                }
            },
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

        // Split the final response if necessary.
        const chunks = splitMessage(aiResponse);

        // Replace streaming preview with final answer.
        await safeEdit(
            replyMessage,
            chunks[0] || "I couldn't generate a response."
        );

        // Send remaining parts as separate messages.
        for (let i = 1; i < chunks.length; i++) {
            await message.channel.send({
                content: chunks[i],
                allowedMentions: {
                    parse: [],
                },
            });
        }

        console.log(
            `✅ AI Reply Completed | User: ${message.author.tag} | Parts: ${chunks.length}`
        );

    } catch (error) {
        console.error("❌ AI Message Handler Error:", {
            name: error?.name,
            message: error?.message,
            status: error?.status || error?.code || "Unknown",
        });

        // Update the existing reply instead of sending a duplicate.
        await safeEdit(
            replyMessage,
            "⚠️ AI response generate nahi ho paya. Please try again."
        );
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

            // Avoid excessively large prompts.
            if (userMessage.length > MAX_INPUT_LENGTH) {
                await message.reply({
                    content: "⚠️ Your message is too long. Please shorten it.",
                    allowedMentions: {
                        repliedUser: false,
                        parse: [],
                    },
                });

                return;
            }

            // Load server AI configuration.
            const config = await getAIConfig(message.guild.id);

            if (!config.enabled) return;

            // Only respond inside configured AI channels.
            if (!config.channels?.includes(message.channel.id)) {
                return;
            }

            // Create a separate reply immediately.
            const replyMessage = await message.reply({
                content: "💭 Thinking...",
                allowedMentions: {
                    repliedUser: false,
                    parse: [],
                },
            });

            const queueKey = getQueueKey(
                message.guild.id,
                message.author.id
            );

            // Process requests in the order they were received.
            enqueueUserRequest(queueKey, () =>
                processAIMessage(
                    message,
                    replyMessage,
                    userMessage
                )
            ).catch(error => {
                console.error(
                    "❌ AI Queue Error:",
                    error.message
                );
            });

        } catch (error) {
            console.error("❌ Message Create Error:", {
                name: error?.name,
                message: error?.message,
            });
        }
    },
};
