"use strict";

// Short-term, in-memory only: cleared on restart, isolated per guild + user.
const conversations = new Map();

const MAX_EXCHANGES = 10;
const EXPIRY_TIME = 30 * 60 * 1000;
const MAX_CONVERSATIONS = 2000;
const MAX_STORED_MESSAGE_CHARS = 8000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

function getKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function isExpired(record, now = Date.now()) {
    return now - record.updatedAt > EXPIRY_TIME;
}

function getConversationRecord(key) {
    const record = conversations.get(key);
    if (!record) return null;

    if (isExpired(record)) {
        conversations.delete(key);
        return null;
    }
    return record;
}

/** Returns a copy, so callers can never mutate stored history. */
function getConversation(guildId, userId) {
    const record = getConversationRecord(getKey(guildId, userId));
    return (record?.messages || []).map(message => ({
        role: message.role,
        parts: message.parts.map(part => ({ ...part })),
    }));
}

function getConversationLanguage(guildId, userId) {
    return getConversationRecord(getKey(guildId, userId))?.language;
}

function clip(text) {
    const value = String(text ?? "");

    return value.length > MAX_STORED_MESSAGE_CHARS
        ? value.slice(0, MAX_STORED_MESSAGE_CHARS)
        : value;
}

function storeConversation(key, messages, language) {
    // Keep memory bounded: drop the oldest conversation if we are at capacity.
    if (!conversations.has(key) && conversations.size >= MAX_CONVERSATIONS) {
        const oldestKey = conversations.keys().next().value;
        conversations.delete(oldestKey);
    }

    conversations.delete(key); // re-insert so Map order tracks recency

    conversations.set(key, {
        messages: messages.slice(-(MAX_EXCHANGES * 2)),
        language,
        updatedAt: Date.now(),
    });
}

function setConversationLanguage(guildId, userId, language) {
    const key = getKey(guildId, userId);
    storeConversation(key, getConversationRecord(key)?.messages || [], language);
}

function saveConversation(guildId, userId, userMessage, aiMessage) {
    const key = getKey(guildId, userId);
    const record = getConversationRecord(key);
    storeConversation(key, [
        ...(record?.messages || []),
        { role: "user", parts: [{ text: clip(userMessage) }] },
        { role: "model", parts: [{ text: clip(aiMessage) }] },
    ], record?.language);
}

function resetConversation(guildId, userId) {
    return conversations.delete(getKey(guildId, userId));
}

function clearGuildConversations(guildId) {
    const prefix = `${guildId}:`;

    for (const key of [...conversations.keys()]) {
        if (key.startsWith(prefix)) conversations.delete(key);
    }
}

function sweepExpiredConversations(now = Date.now()) {
    let removed = 0;

    for (const [key, record] of conversations) {
        if (isExpired(record, now)) {
            conversations.delete(key);
            removed += 1;
        }
    }

    return removed;
}

function getConversationCount() {
    return conversations.size;
}

const sweeper = setInterval(sweepExpiredConversations, SWEEP_INTERVAL_MS);
sweeper.unref();

module.exports = {
    getConversation,
    getConversationLanguage,
    setConversationLanguage,
    saveConversation,
    resetConversation,
    clearGuildConversations,
    sweepExpiredConversations,
    getConversationCount,
};
