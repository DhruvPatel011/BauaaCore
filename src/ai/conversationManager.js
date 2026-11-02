const conversations = new Map();

const MAX_EXCHANGES = 10;
const EXPIRY_TIME = 30 * 60 * 1000;

function getKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function getConversation(guildId, userId) {
    const key = getKey(guildId, userId);
    const record = conversations.get(key);

    if (!record) return [];

    if (Date.now() - record.updatedAt > EXPIRY_TIME) {
        conversations.delete(key);
        return [];
    }

    return record.messages;
}

function saveConversation(guildId, userId, userMessage, aiMessage) {
    const key = getKey(guildId, userId);

    const messages = getConversation(guildId, userId);

    messages.push(
        { role: "user", parts: [{ text: userMessage }] },
        { role: "model", parts: [{ text: aiMessage }] }
    );

    const maxMessages = MAX_EXCHANGES * 2;

    const limitedMessages = messages.slice(-maxMessages);

    conversations.set(key, {
        messages: limitedMessages,
        updatedAt: Date.now(),
    });
}

function resetConversation(guildId, userId) {
    return conversations.delete(getKey(guildId, userId));
}

function clearGuildConversations(guildId) {
    for (const key of conversations.keys()) {
        if (key.startsWith(`${guildId}:`)) {
            conversations.delete(key);
        }
    }
}

module.exports = {
    getConversation,
    saveConversation,
    resetConversation,
    clearGuildConversations,
};