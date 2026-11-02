
const { getDatabase } = require("../config/database");

const COLLECTION_NAME = "guild_ai_config";

const DEFAULT_CONFIG = {
    enabled: true,
    provider: "gemini",
    channels: [],
    mood: "default",
};

function getCollection() {
    return getDatabase().collection(COLLECTION_NAME);
}

// Get existing server configuration or create a default one.
async function getAIConfig(guildId) {
    if (!guildId) {
        throw new Error("Guild ID is required.");
    }

    const collection = getCollection();

    let config = await collection.findOne({ guildId });

    if (!config) {
        const newConfig = {
            guildId,
            ...DEFAULT_CONFIG,
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        await collection.insertOne(newConfig);
        config = newConfig;
    }

    return config;
}

// Add an AI channel without removing existing channels.
async function addAIChannel(guildId, channelId) {
    if (!guildId || !channelId) {
        throw new Error("Guild ID and channel ID are required.");
    }

    await getAIConfig(guildId);

    const result = await getCollection().updateOne(
        { guildId },
        {
            $addToSet: { channels: channelId },
            $set: { updatedAt: new Date() },
        }
    );

    return result;
}

// Remove an AI channel.
async function removeAIChannel(guildId, channelId) {
    if (!guildId || !channelId) {
        throw new Error("Guild ID and channel ID are required.");
    }

    return getCollection().updateOne(
        { guildId },
        {
            $pull: { channels: channelId },
            $set: { updatedAt: new Date() },
        }
    );
}

// Enable or disable AI for a server.
async function setAIEnabled(guildId, enabled) {
    await getAIConfig(guildId);

    return getCollection().updateOne(
        { guildId },
        {
            $set: {
                enabled: Boolean(enabled),
                updatedAt: new Date(),
            },
        }
    );
}

// Change server-wide AI personality.
async function setAIMood(guildId, mood) {
    await getAIConfig(guildId);

    return getCollection().updateOne(
        { guildId },
        {
            $set: {
                mood,
                updatedAt: new Date(),
            },
        }
    );
}

module.exports = {
    getAIConfig,
    addAIChannel,
    removeAIChannel,
    setAIEnabled,
    setAIMood,
};
