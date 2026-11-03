"use strict";

const { getDatabase } = require("../config/database");
const { getRuntimeSettings } = require("./aiConfig");
const { sanitizeSingleLine, findSecret, findInjection } = require("./contentFilters");

/**
 * Server custom instructions, one document per guild in `ai_custom_instructions`.
 * They sit BELOW the built-in safety/language/accuracy rules in the prompt and are
 * validated on save (no secrets, no prompt-injection phrasing). Only admins can
 * change them (enforced by the /ai-instructions command).
 */

const COLLECTION_NAME = "ai_custom_instructions";
const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const SNOWFLAKE = /^\d{17,20}$/;

const cache = new Map(); // guildId -> { value: string|null, expires }
let indexPromise = null;

function getCollection() {
    return getDatabase().collection(COLLECTION_NAME);
}

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
            console.warn("[AI Instructions] Index creation failed:", String(error?.message || error).slice(0, 300));
            indexPromise = null;
            return false;
        });

    return indexPromise;
}

function validateInstructions(input) {
    const max = getRuntimeSettings().maxCustomInstructionChars;
    const text = sanitizeSingleLine(input);

    if (text.length < 3) return { ok: false, message: "Instructions are too short." };
    if (text.length > max) return { ok: false, message: `Instructions are too long. Maximum is ${max} characters.` };

    const secret = findSecret(text);
    if (secret) return { ok: false, message: `Instructions must not contain ${secret}.` };

    const injection = findInjection(text);
    if (injection) {
        return {
            ok: false,
            message: `That looks like ${injection}. Custom instructions can adjust tone and server context, not the bot's core rules.`,
        };
    }

    return { ok: true, text };
}

function writeCache(guildId, value) {
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();

    cache.set(guildId, { value, expires: Date.now() + CACHE_TTL_MS });
}

async function getCustomInstructions(guildId) {
    if (!SNOWFLAKE.test(String(guildId))) return null;

    const cached = cache.get(guildId);

    if (cached && cached.expires > Date.now()) return cached.value;

    const doc = await getCollection().findOne({ guildId });
    const value = typeof doc?.text === "string" && doc.text.trim() ? doc.text : null;

    writeCache(guildId, value);

    return value;
}

async function setCustomInstructions(guildId, text, updatedBy) {
    if (!SNOWFLAKE.test(String(guildId))) throw new Error("Valid guild ID required.");

    const validation = validateInstructions(text);

    if (!validation.ok) return validation;

    await ensureIndexes();

    const now = new Date();

    await getCollection().updateOne(
        { guildId },
        {
            $set: {
                text: validation.text,
                updatedBy: updatedBy ? String(updatedBy) : null,
                updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
        },
        { upsert: true }
    );

    cache.delete(guildId);

    return { ok: true, text: validation.text };
}

async function clearCustomInstructions(guildId) {
    if (!SNOWFLAKE.test(String(guildId))) throw new Error("Valid guild ID required.");

    const result = await getCollection().deleteOne({ guildId });

    cache.delete(guildId);

    return (result.deletedCount || 0) > 0;
}

module.exports = {
    validateInstructions,
    getCustomInstructions,
    setCustomInstructions,
    clearCustomInstructions,
};
