"use strict";

const { getDatabase } = require("../config/database");
const { DEFAULT_CONFIG, MOODS } = require("./aiConfig");

const COLLECTION_NAME = "guild_ai_config";
const CACHE_TTL_MS = 30 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const SNOWFLAKE = /^\d{17,20}$/;

// guildId -> { value: config | null, expires: number }
const cache = new Map();
let indexPromise = null;

function getCollection() {
    return getDatabase().collection(COLLECTION_NAME);
}

// --------------------------------------------------
// Indexes (lazy, so index.js / database.js need no changes)
// --------------------------------------------------

function ensureIndexes() {
    if (indexPromise) return indexPromise;

    let collection;

    try {
        collection = getCollection();
    } catch {
        return Promise.resolve(false);
    }

    indexPromise = Promise.resolve()
        .then(() => collection.createIndex({ guildId: 1 }, { unique: true }))
        .then(() => true)
        .catch(error => {
            console.warn(
                "[AI Config] Could not create unique guildId index:",
                String(error?.message || error).slice(0, 300)
            );

            // Duplicate guild documents exist: do not retry forever.
            // Any other failure (e.g. network) is retried on the next call.
            if (error?.code !== 11000 && error?.code !== 11001) {
                indexPromise = null;
            }

            return false;
        });

    return indexPromise;
}

// --------------------------------------------------
// Normalisation + cache
// --------------------------------------------------

/** Make old documents (missing fields, provider "gemini", unknown mood) safe to use. */
function normalizeConfig(doc) {
    if (!doc) return null;

    return {
        ...doc,
        guildId: String(doc.guildId),
        enabled: typeof doc.enabled === "boolean" ? doc.enabled : DEFAULT_CONFIG.enabled,
        provider: "groq",
        channels: Array.isArray(doc.channels)
            ? doc.channels.filter(id => typeof id === "string")
            : [],
        mood: Object.hasOwn(MOODS, doc.mood) ? doc.mood : DEFAULT_CONFIG.mood,
    };
}

function cloneConfig(config) {
    return config ? { ...config, channels: [...config.channels] } : null;
}

function readCache(guildId) {
    const entry = cache.get(guildId);

    if (!entry) return undefined;

    if (entry.expires < Date.now()) {
        cache.delete(guildId);
        return undefined;
    }

    return entry.value;
}

function writeCache(guildId, value) {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();

    cache.set(guildId, { value, expires: Date.now() + CACHE_TTL_MS });
}

function invalidateAIConfigCache(guildId) {
    if (guildId) cache.delete(guildId);
    else cache.clear();
}

// --------------------------------------------------
// Reads
// --------------------------------------------------

async function createDefaultAtomically(collection, guildId) {
    const now = new Date();

    try {
        return await collection.findOneAndUpdate(
            { guildId },
            {
                $setOnInsert: {
                    ...DEFAULT_CONFIG,
                    channels: [],
                    createdAt: now,
                    updatedAt: now,
                },
            },
            { upsert: true, returnDocument: "after" }
        );
    } catch (error) {
        // Two requests raced; the other one created it first.
        if (error?.code === 11000) return collection.findOne({ guildId });
        throw error;
    }
}

/**
 * Get the server configuration, creating a default one if it does not exist.
 * Used by commands. Message handling should use peekAIConfig instead.
 */
async function getAIConfig(guildId) {
    if (!guildId) {
        throw new Error("Guild ID is required.");
    }

    const cached = readCache(guildId);

    if (cached) return cloneConfig(cached);

    await ensureIndexes();

    const doc = await createDefaultAtomically(getCollection(), guildId);
    const config = normalizeConfig(doc);

    writeCache(guildId, config);

    return cloneConfig(config);
}

/**
 * Read-only lookup for hot paths (every Discord message).
 * Never inserts documents; returns null when the guild has no AI config.
 * Result is cached briefly so ordinary chat does not hit MongoDB per message.
 */
async function peekAIConfig(guildId) {
    if (!guildId) return null;

    const cached = readCache(guildId);

    if (cached !== undefined) return cloneConfig(cached);

    const config = normalizeConfig(await getCollection().findOne({ guildId }));

    writeCache(guildId, config);

    return cloneConfig(config);
}

// --------------------------------------------------
// Writes (all invalidate the cache)
// --------------------------------------------------

async function addAIChannel(guildId, channelId) {
    if (!guildId || !channelId) {
        throw new Error("Guild ID and channel ID are required.");
    }

    if (!SNOWFLAKE.test(String(channelId))) {
        throw new Error("Invalid channel ID.");
    }

    await getAIConfig(guildId);

    const result = await getCollection().updateOne(
        { guildId },
        {
            $addToSet: { channels: String(channelId) },
            $set: { updatedAt: new Date() },
        }
    );

    invalidateAIConfigCache(guildId);

    return result;
}

async function removeAIChannel(guildId, channelId) {
    if (!guildId || !channelId) {
        throw new Error("Guild ID and channel ID are required.");
    }

    const result = await getCollection().updateOne(
        { guildId },
        {
            $pull: { channels: String(channelId) },
            $set: { updatedAt: new Date() },
        }
    );

    invalidateAIConfigCache(guildId);

    return result;
}

async function setAIEnabled(guildId, enabled) {
    await getAIConfig(guildId);

    const result = await getCollection().updateOne(
        { guildId },
        {
            $set: {
                enabled: Boolean(enabled),
                updatedAt: new Date(),
            },
        }
    );

    invalidateAIConfigCache(guildId);

    return result;
}

async function setAIMood(guildId, mood) {
    if (!Object.hasOwn(MOODS, mood)) {
        throw new Error(`Unknown AI mood: ${String(mood).slice(0, 40)}`);
    }

    await getAIConfig(guildId);

    const result = await getCollection().updateOne(
        { guildId },
        {
            $set: {
                mood,
                updatedAt: new Date(),
            },
        }
    );

    invalidateAIConfigCache(guildId);

    return result;
}

module.exports = {
    getAIConfig,
    peekAIConfig,
    addAIChannel,
    removeAIChannel,
    setAIEnabled,
    setAIMood,
    normalizeConfig,
    invalidateAIConfigCache,
};
