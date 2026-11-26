const { createHash } = require("node:crypto");
const { getDatabase } = require("../config/database");

const EVENT_RETENTION_MS = 10 * 60_000;

async function claimLogEvent(guildId, type, ...identity) {
    const _id = createHash("sha256").update(JSON.stringify([guildId, type, ...identity])).digest("hex");
    try {
        const result = await getDatabase().collection("logged_events").updateOne(
            { _id },
            { $setOnInsert: { expiresAt: new Date(Date.now() + EVENT_RETENTION_MS) } },
            { upsert: true }
        );
        return result.upsertedCount === 1;
    } catch (error) {
        if (error.code === 11000) return false;
        throw error;
    }
}

async function claimVoiceTransition(guildId, userId, sessionId, oldChannelId, newChannelId) {
    const _id = createHash("sha256").update(JSON.stringify([guildId, "voiceTransition", userId])).digest("hex");
    const transition = JSON.stringify([sessionId, oldChannelId, newChannelId]);
    // A voice session can span multiple joins and leaves. Only suppress a repeat of the latest transition.
    try {
        const result = await getDatabase().collection("logged_events").updateOne(
            { _id, transition: { $ne: transition } },
            { $set: { transition, expiresAt: new Date(Date.now() + EVENT_RETENTION_MS) } },
            { upsert: true }
        );
        return result.modifiedCount === 1 || result.upsertedCount === 1;
    } catch (error) {
        if (error.code === 11000) return false;
        throw error;
    }
}

module.exports = { claimLogEvent, claimVoiceTransition };
