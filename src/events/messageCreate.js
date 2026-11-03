"use strict";

const { PermissionFlagsBits } = require("discord.js");

const { peekAIConfig } = require("../ai/aiConfigManager");
const { getRuntimeSettings, MOODS } = require("../ai/aiConfig");
const { getConversation, saveConversation } = require("../ai/conversationManager");
const { generateAIResponseStream } = require("../ai/geminiClient");
const { buildSystemPrompt } = require("../ai/prompt");
const { buildContext } = require("../ai/contextManager");
const { getCustomInstructions } = require("../ai/instructionManager");
const memoryManager = require("../ai/memoryManager");
const usage = require("../ai/usageLimiter");
const { stripControlChars } = require("../ai/contentFilters");
const { splitMessage, DISCORD_SAFE_LENGTH } = require("../ai/messageUtils");
const {
    createAIError,
    getFriendlyError,
    logThrottled,
    describeError,
} = require("../ai/aiErrors");

// One active request per user per server. A newer message cancels the older one.
const activeRequests = new Map();

// Message IDs already handled in this process (guards against duplicate event delivery).
const handledMessages = new Map();

// Last time a rate-limit notice was shown to a user (avoids spamming the notice itself).
const rateNotices = new Map();

const MAX_MESSAGE_LENGTH = 12000;
const STREAM_EDIT_INTERVAL_MS = 1500;
const HANDLED_TTL_MS = 2 * 60 * 1000;
const NO_MENTIONS = { parse: [], repliedUser: false };

// --------------------------------------------------
// Small helpers
// --------------------------------------------------

function getRequestKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function isCurrentRequest(requestKey, request) {
    return activeRequests.get(requestKey) === request;
}

function isDuplicateMessage(messageId) {
    const now = Date.now();

    if (handledMessages.size > 1000) {
        for (const [id, time] of handledMessages) {
            if (now - time > HANDLED_TTL_MS) handledMessages.delete(id);
        }
    }

    if (handledMessages.has(messageId)) return true;

    handledMessages.set(messageId, now);

    return false;
}

async function safeDelete(message) {
    try {
        if (message?.deletable) await message.delete();
    } catch {
        // Ignore Discord deletion errors.
    }
}

async function safeEdit(message, content) {
    try {
        if (message?.editable) {
            return await message.edit({ content, allowedMentions: NO_MENTIONS });
        }
    } catch (error) {
        console.error("AI Reply Edit Error:", error.message);
    }

    return null;
}

async function safeSend(channel, content) {
    try {
        return await channel.send({ content, allowedMentions: NO_MENTIONS });
    } catch (error) {
        console.error("AI Send Error:", error.message);
        return null;
    }
}

function canRespond(message) {
    try {
        const permissions = message.channel.permissionsFor?.(message.client?.user);

        if (!permissions) return true; // cannot tell; try anyway

        return permissions.has(PermissionFlagsBits.ViewChannel) &&
            permissions.has(PermissionFlagsBits.SendMessages);
    } catch {
        return true;
    }
}

// --------------------------------------------------
// Live streaming edits (throttled; at most one edit in flight)
// --------------------------------------------------

function createStreamEditor(replyMessage, isActive) {
    let lastEdit = 0;
    let inFlight = null;

    return {
        push(text) {
            const now = Date.now();

            if (inFlight || now - lastEdit < STREAM_EDIT_INTERVAL_MS || !isActive()) return;

            const preview = text.length > DISCORD_SAFE_LENGTH - 5
                ? `${text.slice(0, DISCORD_SAFE_LENGTH - 5)}…`
                : `${text} ▌`;

            lastEdit = now;
            inFlight = safeEdit(replyMessage, preview).finally(() => {
                inFlight = null;
            });
        },

        async settle() {
            if (inFlight) await inFlight;
        },
    };
}

// --------------------------------------------------
// Final delivery
// --------------------------------------------------

async function sendAIResponse(replyMessage, channel, response, requestKey, request) {
    const chunks = splitMessage(response);

    if (!chunks.length) {
        await safeEdit(replyMessage, "I couldn't generate a response. Please try again.");
        return;
    }

    if (!isCurrentRequest(requestKey, request)) return;

    const edited = await safeEdit(replyMessage, chunks[0]);

    if (!edited) {
        await safeDelete(replyMessage);

        if (!isCurrentRequest(requestKey, request)) return;

        await safeSend(channel, chunks[0]);
    }

    for (let i = 1; i < chunks.length; i++) {
        if (!isCurrentRequest(requestKey, request)) return;

        await safeSend(channel, chunks[i]);
    }
}

// --------------------------------------------------
// Memory intents typed in chat ("remember that ...", "forget my memory")
// --------------------------------------------------

async function handleMemoryIntent(message, userMessage, appNotes) {
    const intent = memoryManager.detectMemoryIntent(userMessage);

    if (!intent) return;

    const guildId = message.guild.id;
    const userId = message.author.id;

    try {
        if (intent.action === "clear_all") {
            const removed = await memoryManager.clearMemories(guildId, userId);

            appNotes.push(
                `The user asked to erase everything saved about them and ${removed} saved memory item(s) were deleted. Confirm briefly.`
            );

            return;
        }

        const result = await memoryManager.addMemory(guildId, userId, intent.content, { source: "chat" });

        if (result.ok) {
            appNotes.push(
                `The user asked you to remember something and it was saved to their long-term memory: "${result.text}". Confirm briefly in one short sentence.`
            );
        } else {
            appNotes.push(
                `The user asked you to remember something but it was NOT saved. Reason: ${result.message} Tell them briefly and kindly.`
            );
        }
    } catch (error) {
        logThrottled("ai-memory-write", 60000, "[AI Memory] Write failed:", describeError(error));

        appNotes.push(
            "The user asked about saved memory but it could not be updated because of a temporary technical problem. Say so briefly."
        );
    }
}

// --------------------------------------------------
// Main processor
// --------------------------------------------------

async function processAIMessage({ message, replyMessage, userMessage, request, requestKey, config }) {
    let typingInterval = null;

    // A request is "superseded" when the same user sent a newer message (or it was cancelled).
    const superseded = () =>
        !isCurrentRequest(requestKey, request) || request.controller.signal.aborted;

    // Never leave an orphaned "Thinking..." message behind.
    const abandon = () => safeDelete(replyMessage);

    try {
        if (superseded()) return await abandon();

        const settings = getRuntimeSettings();
        const guildId = message.guild.id;
        const userId = message.author.id;
        const appNotes = [];

        const memoryEnabled = settings.longTermMemory;

        if (memoryEnabled) {
            await handleMemoryIntent(message, userMessage, appNotes);
        }

        if (superseded()) return await abandon();

        const history = getConversation(guildId, userId);

        const context = await buildContext({
            guildId,
            userId,
            message: userMessage,
            history,
            memoryEnabled,
        });

        if (superseded()) return await abandon();

        let customInstructions = null;

        try {
            customInstructions = await getCustomInstructions(guildId);
        } catch (error) {
            logThrottled("ai-instructions-read", 60000, "[AI Instructions] Read failed:", describeError(error));
        }

        const systemPrompt = buildSystemPrompt(config.mood, {
            customInstructions,
            memories: context.memories,
            languageDirective: context.language.directive,
            conversationType: context.conversationType,
            appNotes,
        });

        // Typing indicator (errors ignored; refreshed while generating).
        message.channel.sendTyping().catch(() => {});

        typingInterval = setInterval(() => {
            if (isCurrentRequest(requestKey, request) && !request.controller.signal.aborted) {
                message.channel.sendTyping().catch(() => {});
            }
        }, 8000);

        console.log(
            `AI Processing | Server: ${message.guild.name} | User: ${message.author.username} | Mood: ${config.mood} | Type: ${context.conversationType}`
        );

        const editor = createStreamEditor(
            replyMessage,
            () => isCurrentRequest(requestKey, request) && !request.controller.signal.aborted
        );

        const meta = {};
        const mood = MOODS[config.mood] || MOODS.default;
        const technical = ["coding", "complete_code"].includes(context.conversationType);

        const response = await generateAIResponseStream({
            history: context.history,
            message: userMessage,
            systemPrompt,
            signal: request.controller.signal,
            maxTokens: context.maxOutputTokens,
            temperature: technical ? Math.min(mood.temperature, 0.3) : mood.temperature,
            onText: settings.streamEdits ? text => editor.push(text) : undefined,
            meta,
        });

        await editor.settle();

        if (superseded()) return await abandon();

        // Save the exchange only after a successful generation.
        saveConversation(guildId, userId, userMessage, response);

        const finalText = meta.finishReason === "length"
            ? `${response}\n\n*(Response was cut off because it hit the length limit. Say "continue" for the rest.)*`
            : response;

        await sendAIResponse(replyMessage, message.channel, finalText, requestKey, request);

    } catch (error) {
        if (
            request.controller.signal.aborted ||
            error?.name === "AbortError" ||
            error?.code === "REQUEST_CANCELLED"
        ) {
            console.log(`AI Request Cancelled | User: ${message.author.username}`);
            await safeDelete(replyMessage);
            return;
        }

        console.error("AI Message Handler Error:", describeError(error));

        if (!isCurrentRequest(requestKey, request)) return await abandon();

        await safeEdit(replyMessage, getFriendlyError(error));

    } finally {
        if (typingInterval) clearInterval(typingInterval);

        usage.releaseSlot(request);

        if (isCurrentRequest(requestKey, request)) {
            activeRequests.delete(requestKey);
        }
    }
}

// --------------------------------------------------
// Discord event
// --------------------------------------------------

async function sendRateNotice(message, text) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();

    if (now - (rateNotices.get(key) || 0) < 15000) return;

    if (rateNotices.size > 1000) rateNotices.clear();

    rateNotices.set(key, now);

    try {
        await message.reply({ content: text, allowedMentions: NO_MENTIONS });
    } catch {
        // Ignore: user may have deleted the message or we lack permission.
    }
}

module.exports = {
    name: "messageCreate",

    async execute(message) {
        try {
            // Cheap structural checks first (no database access).
            if (!message.guild) return;
            if (!message.author || message.author.bot) return;
            if (message.webhookId || message.system) return;
            if (typeof message.content !== "string" || !message.content.trim()) return;

            // Decide whether this channel is an AI channel BEFORE doing anything visible.
            let config;

            try {
                config = await peekAIConfig(message.guild.id);
            } catch (error) {
                logThrottled("ai-config-read", 60000, "[AI] Config lookup failed:", describeError(error));
                return;
            }

            if (!config || !config.enabled) return;
            if (!config.channels.includes(message.channel.id)) return;
            if (!canRespond(message)) return;
            if (isDuplicateMessage(message.id)) return;

            const userMessage = stripControlChars(message.content).trim();

            if (!userMessage) return;

            if (userMessage.length > MAX_MESSAGE_LENGTH) {
                await message.reply({
                    content: `Your message is too long. Maximum allowed length is ${MAX_MESSAGE_LENGTH} characters.`,
                    allowedMentions: NO_MENTIONS,
                });
                return;
            }

            // Usage controls.
            const userRate = usage.consumeUserRate(message.guild.id, message.author.id);

            if (!userRate.allowed) {
                const seconds = Math.ceil(userRate.retryAfterMs / 1000);
                await sendRateNotice(message, `⏳ You're sending messages too fast. Try again in about ${seconds}s.`);
                return;
            }

            const budget = usage.consumeGuildBudget(message.guild.id);

            if (!budget.allowed) {
                await sendRateNotice(message, getFriendlyError(createAIError("AI_GUILD_LIMIT", "limit")));
                return;
            }

            const requestKey = getRequestKey(message.guild.id, message.author.id);

            // A new message from the same user cancels their previous request.
            const previous = activeRequests.get(requestKey);

            if (previous) {
                previous.controller.abort();
                usage.releaseSlot(previous);
            }

            const request = { controller: new AbortController(), slotHeld: false };

            if (!usage.tryAcquireSlot(request)) {
                activeRequests.delete(requestKey);
                await sendRateNotice(message, getFriendlyError(createAIError("AI_BUSY", "busy")));
                return;
            }

            activeRequests.set(requestKey, request);

            let replyMessage = null;

            try {
                replyMessage = await message.reply({
                    content: "💭 Thinking...",
                    allowedMentions: NO_MENTIONS,
                });
            } catch {
                replyMessage = await safeSend(message.channel, "💭 Thinking...");
            }

            if (!replyMessage) {
                // Could not show anything at all: clean up so no state goes stale.
                usage.releaseSlot(request);

                if (isCurrentRequest(requestKey, request)) activeRequests.delete(requestKey);

                return;
            }

            // Process in the background so other users are never blocked.
            void processAIMessage({
                message,
                replyMessage,
                userMessage,
                request,
                requestKey,
                config,
            });

        } catch (error) {
            console.error("AI Message Event Error:", describeError(error));
        }
    },

    // Exposed for tests only.
    processAIMessage,
    __internals: { activeRequests, handledMessages, rateNotices },
};
