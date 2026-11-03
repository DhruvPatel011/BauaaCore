"use strict";

const { getRuntimeSettings } = require("./aiConfig");

/**
 * In-memory usage controls for a small bot on a single Render instance.
 * Counters reset on restart, so they protect the free-tier quota but are not billing records.
 */

const userWindows = new Map(); // "guild:user" -> number[] (timestamps)
const guildDays = new Map(); // guildId -> { day, count }
let activeSlots = 0;

function utcDay(now) {
    return new Date(now).toISOString().slice(0, 10);
}

/** Sliding-window per-user limit. Consumes one token when allowed. */
function consumeUserRate(guildId, userId, now = Date.now()) {
    const settings = getRuntimeSettings();
    const windowMs = settings.userRateWindowSeconds * 1000;
    const key = `${guildId}:${userId}`;
    const recent = (userWindows.get(key) || []).filter(time => now - time < windowMs);

    if (recent.length >= settings.userRateLimit) {
        userWindows.set(key, recent);

        return { allowed: false, retryAfterMs: Math.max(1000, windowMs - (now - recent[0])) };
    }

    recent.push(now);
    userWindows.set(key, recent);

    return { allowed: true, retryAfterMs: 0 };
}

/** Per-server daily request budget (UTC day). Consumes one request when allowed. */
function consumeGuildBudget(guildId, now = Date.now()) {
    const limit = getRuntimeSettings().guildDailyLimit;
    const day = utcDay(now);
    let record = guildDays.get(guildId);

    if (!record || record.day !== day) {
        record = { day, count: 0 };
        guildDays.set(guildId, record);
    }

    if (record.count >= limit) return { allowed: false, used: record.count, limit };

    record.count += 1;

    return { allowed: true, used: record.count, limit };
}

function getGuildUsage(guildId, now = Date.now()) {
    const record = guildDays.get(guildId);

    return {
        used: record && record.day === utcDay(now) ? record.count : 0,
        limit: getRuntimeSettings().guildDailyLimit,
    };
}

/** Global concurrency slot, owned by a request object so it is released exactly once. */
function tryAcquireSlot(request) {
    if (request.slotHeld) return true;

    if (activeSlots >= getRuntimeSettings().maxConcurrent) return false;

    activeSlots += 1;
    request.slotHeld = true;

    return true;
}

function releaseSlot(request) {
    if (!request?.slotHeld) return;

    request.slotHeld = false;
    activeSlots = Math.max(0, activeSlots - 1);
}

function getActiveSlots() {
    return activeSlots;
}

function sweep(now = Date.now()) {
    const windowMs = getRuntimeSettings().userRateWindowSeconds * 1000;

    for (const [key, times] of userWindows) {
        if (!times.some(time => now - time < windowMs)) userWindows.delete(key);
    }

    const today = utcDay(now);

    for (const [guildId, record] of guildDays) {
        if (record.day !== today) guildDays.delete(guildId);
    }
}

function resetForTests() {
    userWindows.clear();
    guildDays.clear();
    activeSlots = 0;
}

const sweeper = setInterval(sweep, 10 * 60 * 1000);
sweeper.unref();

module.exports = {
    consumeUserRate,
    consumeGuildBudget,
    getGuildUsage,
    tryAcquireSlot,
    releaseSlot,
    getActiveSlots,
    sweep,
    resetForTests,
};
