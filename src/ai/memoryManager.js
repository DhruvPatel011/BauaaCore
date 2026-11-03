"use strict";

const crypto = require("node:crypto");
const { getDatabase } = require("../config/database");
const { getRuntimeSettings } = require("./aiConfig");
const { sanitizeSingleLine, findSecret, findSensitive, findInjection } = require("./contentFilters");
const { tokenize } = require("./messageUtils");

/**
 * Long-term memory: one document per remembered item in `ai_user_memory`.
 * Every query is scoped by BOTH guildId and userId, so one member can never read
 * another member's memory, and memory never crosses servers.
 *
 * Memories are only created from explicit requests ("remember that ...",
 * "yaad rakhna ...", /ai-memory add). Nothing is inferred or stored automatically.
 */

const COLLECTION_NAME = "ai_user_memory";
const SNOWFLAKE = /^\d{17,20}$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 300;
const EXPIRY_DAYS = 180;
const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

const cache = new Map(); // "guildId:userId" -> { items, expires }
let indexPromise = null;

function getCollection() {
    return getDatabase().collection(COLLECTION_NAME);
}

function isLongTermMemoryEnabled() {
    return getRuntimeSettings().longTermMemory;
}

function assertIds(guildId, userId) {
    if (!SNOWFLAKE.test(String(guildId)) || !SNOWFLAKE.test(String(userId))) {
        throw new Error("Valid guild and user IDs are required for memory access.");
    }
}

function cacheKey(guildId, userId) {
    return `${guildId}:${userId}`;
}

function invalidate(guildId, userId) {
    cache.delete(cacheKey(guildId, userId));
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
        .then(() => Promise.all([
            collection.createIndex({ guildId: 1, userId: 1, key: 1 }, { unique: true }),
            collection.createIndex({ guildId: 1, userId: 1, updatedAt: -1 }),
            // Stale memories disappear on their own (TTL on expireAt).
            collection.createIndex({ expireAt: 1 }, { expireAfterSeconds: 0 }),
        ]))
        .then(() => true)
        .catch(error => {
            console.warn("[AI Memory] Index creation failed:", String(error?.message || error).slice(0, 300));
            indexPromise = null;
            return false;
        });

    return indexPromise;
}

// --------------------------------------------------
// Validation
// --------------------------------------------------

const REASON_TEXT = {
    too_short: "That is too short to remember.",
    too_long: `That is too long. Keep it under ${MAX_LENGTH} characters.`,
    secret: "That looks like a secret, credential or personal identifier, and I never store those.",
    sensitive: "That looks like sensitive personal information, and I don't store that.",
    injection: "That looks like an attempt to change my rules, so I won't store it.",
    full: "Your memory is full. Remove something with /ai-memory forget first.",
    disabled: "Long-term memory is turned off on this bot.",
};

function validateMemoryContent(input) {
    const text = sanitizeSingleLine(input);

    if (text.length < MIN_LENGTH) return { ok: false, reason: "too_short", message: REASON_TEXT.too_short };
    if (text.length > MAX_LENGTH) return { ok: false, reason: "too_long", message: REASON_TEXT.too_long };

    if (findSecret(text)) return { ok: false, reason: "secret", message: REASON_TEXT.secret };
    if (findInjection(text)) return { ok: false, reason: "injection", message: REASON_TEXT.injection };
    if (findSensitive(text)) return { ok: false, reason: "sensitive", message: REASON_TEXT.sensitive };

    return { ok: true, text };
}

// --------------------------------------------------
// Classification
// --------------------------------------------------

const TECH_PATTERN =
    /\b(?:node(?:\.?js)?|javascript|typescript|python|java|c\+\+|c#|react|vue|angular|next\.?js|express|mongodb|mongo|mysql|postgres(?:ql)?|sql|discord\.?js|django|flask|docker|git|linux|rust|golang|php|laravel|tailwind|html|css|vite)\b/i;

function classifyMemory(text) {
    if (/\b(?:prefer|prefers|like|likes|love|hate|call me|reply|respond|speak|language|short|brief|detailed|concise|tone|style)\b|pasand|chhota|chota/i.test(text)) {
        return "preference";
    }

    if (TECH_PATTERN.test(text)) return "tech";
    if (/\b(?:project|building|working on|bot|app|website|startup|thesis)\b/i.test(text)) return "project";

    return "fact";
}

// Singleton "slots": a new value replaces the old one, so memories never contradict.
function detectSlot(text) {
    if (/\b(?:reply|respond|speak|talk|answer)\b.*\b(?:english|hindi|hinglish|gujarati|punjabi|urdu)\b|\bpreferred language\b/i.test(text)) {
        return "language";
    }

    if (/\b(?:short|brief|concise|detailed|long)\b.*\b(?:answer|repl\w*|response)s?\b/i.test(text)) return "length";
    if (/\bcall me\b/i.test(text)) return "nickname";

    return null;
}

function memoryKey(text) {
    return crypto
        .createHash("sha1")
        .update(text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim())
        .digest("hex")
        .slice(0, 16);
}

// --------------------------------------------------
// Explicit intent detection (chat phrases)
// --------------------------------------------------

const SAVE_PATTERNS = [
    /^\s*(?:please\s+|pls\s+)?(?:remember|keep in mind|note)(?:\s+that\b|\s*:)\s*(.{3,})$/is,
    /^\s*(?:please\s+|pls\s+)?remember\s+((?:i|i'm|im|i've|my|call me|reply|respond|always|never)\b.{2,})$/is,
    /^\s*from now on[\s,:-]+(.{3,})$/is,
    /^\s*(?:yaad rakh(?:na|o|e|iyo)?|dhyan rakh(?:na|o)?)(?:\s+ki)?[\s:,-]+(.{3,})$/is,
    /^\s*(.{3,}?)[\s,.-]*(?:yaad rakh(?:na|o|e|iyo)?)\s*[.!]*\s*$/is,
    /^\s*(?:याद रखना|याद रखो|ध्यान रखना)(?:\s+कि)?[\s:,-]+(.{3,})$/s,
    /^\s*(?:યાદ રાખજે|યાદ રાખો)[\s:,-]+(.{3,})$/s,
];

const CLEAR_PATTERNS = [
    /\b(?:forget|delete|clear|erase|wipe)\s+(?:all\s+|everything\s+)?(?:of\s+)?my\s+(?:saved\s+|long[- ]term\s+)?memor(?:y|ies)\b/i,
    /\b(?:forget|delete|clear|erase|wipe)\s+(?:all|everything)\s+(?:that\s+)?(?:you\s+)?(?:know|remember)\s+about\s+me\b/i,
    /\bmeri\s+(?:saari\s+|sab\s+|puri\s+)?memory\s+(?:delete|clear|hata|mita|saaf)/i,
];

/** Returns {action:"save", content} | {action:"clear_all"} | null. */
function detectMemoryIntent(message) {
    const text = String(message ?? "").trim();

    if (!text || text.length > 400) return null;

    if (CLEAR_PATTERNS.some(pattern => pattern.test(text)) && text.length <= 160) {
        return { action: "clear_all" };
    }

    for (const pattern of SAVE_PATTERNS) {
        const match = text.match(pattern);

        if (match?.[1]) {
            const content = match[1].trim().replace(/[\s.!]+$/, "");

            if (content.length >= MIN_LENGTH) return { action: "save", content };
        }
    }

    return null;
}

// --------------------------------------------------
// CRUD
// --------------------------------------------------

async function addMemory(guildId, userId, content, { source = "chat" } = {}) {
    assertIds(guildId, userId);

    if (!isLongTermMemoryEnabled()) {
        return { ok: false, reason: "disabled", message: REASON_TEXT.disabled };
    }

    const validation = validateMemoryContent(content);

    if (!validation.ok) return validation;

    const { text } = validation;
    const key = memoryKey(text);
    const slot = detectSlot(text);
    const collection = getCollection();

    await ensureIndexes();

    const existing = await collection.findOne({ guildId, userId, key });

    if (!existing) {
        const count = await collection.countDocuments({ guildId, userId });

        if (count >= getRuntimeSettings().maxMemoriesPerUser) {
            return { ok: false, reason: "full", message: REASON_TEXT.full };
        }
    }

    // Replace a contradicting memory that occupies the same slot.
    if (slot) {
        await collection.deleteMany({ guildId, userId, slot, key: { $ne: key } });
    }

    const now = new Date();

    await collection.updateOne(
        { guildId, userId, key },
        {
            $set: {
                text,
                type: classifyMemory(text),
                slot,
                keywords: tokenize(text).slice(0, 12),
                source,
                updatedAt: now,
                expireAt: new Date(now.getTime() + EXPIRY_DAYS * 24 * 60 * 60 * 1000),
            },
            $setOnInsert: { createdAt: now },
        },
        { upsert: true }
    );

    invalidate(guildId, userId);

    return { ok: true, text, updated: Boolean(existing) };
}

async function listMemories(guildId, userId) {
    assertIds(guildId, userId);

    const items = await getCollection()
        .find({ guildId, userId })
        .sort({ updatedAt: -1 })
        .limit(getRuntimeSettings().maxMemoriesPerUser)
        .toArray();

    return items.map(item => ({
        text: item.text,
        type: item.type,
        slot: item.slot || null,
        updatedAt: item.updatedAt,
    }));
}

/** Delete the Nth memory (1-based, same order as listMemories). */
async function deleteMemoryByIndex(guildId, userId, index) {
    assertIds(guildId, userId);

    const items = await getCollection()
        .find({ guildId, userId })
        .sort({ updatedAt: -1 })
        .limit(getRuntimeSettings().maxMemoriesPerUser)
        .toArray();

    const target = items[Number(index) - 1];

    if (!target) return { ok: false, text: null };

    const result = await getCollection().deleteOne({ guildId, userId, key: target.key });

    invalidate(guildId, userId);

    return { ok: result.deletedCount > 0, text: target.text };
}

async function clearMemories(guildId, userId) {
    assertIds(guildId, userId);

    const result = await getCollection().deleteMany({ guildId, userId });

    invalidate(guildId, userId);

    return result.deletedCount || 0;
}

// --------------------------------------------------
// Retrieval: only what is relevant to this message
// --------------------------------------------------

async function loadItems(guildId, userId) {
    const key = cacheKey(guildId, userId);
    const cached = cache.get(key);

    if (cached && cached.expires > Date.now()) return cached.items;

    const items = await getCollection()
        .find({ guildId, userId })
        .sort({ updatedAt: -1 })
        .limit(getRuntimeSettings().maxMemoriesPerUser)
        .toArray();

    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();

    cache.set(key, { items, expires: Date.now() + CACHE_TTL_MS });

    return items;
}

async function getRelevantMemories(guildId, userId, message, { limit = 5, maxChars = 700 } = {}) {
    assertIds(guildId, userId);

    if (!isLongTermMemoryEnabled()) return [];

    const items = await loadItems(guildId, userId);

    if (!items.length) return [];

    const messageTokens = new Set(tokenize(message));

    const scored = items.map(item => {
        const overlap = (item.keywords || []).filter(word => messageTokens.has(word)).length;
        const isPreference = item.type === "preference" || Boolean(item.slot);

        return { item, overlap, isPreference };
    });

    // Standing preferences (language, length, nickname) always apply, but are capped.
    const preferences = scored
        .filter(entry => entry.isPreference)
        .sort((a, b) => b.overlap - a.overlap)
        .slice(0, 3);

    const others = scored
        .filter(entry => !entry.isPreference && entry.overlap > 0)
        .sort((a, b) => b.overlap - a.overlap);

    const picked = [...preferences, ...others].slice(0, limit);
    const lines = [];
    let used = 0;

    for (const { item } of picked) {
        const line = String(item.text).slice(0, 200);

        if (used + line.length > maxChars) break;

        lines.push(line);
        used += line.length;
    }

    return lines;
}

module.exports = {
    isLongTermMemoryEnabled,
    validateMemoryContent,
    detectMemoryIntent,
    addMemory,
    listMemories,
    deleteMemoryByIndex,
    clearMemories,
    getRelevantMemories,
};
