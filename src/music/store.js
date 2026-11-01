const fs = require("node:fs");
const path = require("node:path");

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
const filePath = path.join(dataDir, "music.json");

function ensureStore() {
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify({ guilds: {}, users: {} }, null, 2));
    }
}

function readStore() {
    ensureStore();
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
        return {
            guilds: parsed.guilds && typeof parsed.guilds === "object" ? parsed.guilds : {},
            users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
        };
    } catch (error) {
        console.error("[MusicStore] Invalid JSON store; starting a fresh store:", error.message);
        const backup = `${filePath}.corrupt-${Date.now()}`;
        try { fs.copyFileSync(filePath, backup); } catch {}
        const fresh = { guilds: {}, users: {} };
        fs.writeFileSync(filePath, JSON.stringify(fresh, null, 2));
        return fresh;
    }
}

function writeStore(data) {
    ensureStore();
    const temp = `${filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, filePath);
}

function saveGuildSettings(guildId, patch) {
    const data = readStore();
    data.guilds[guildId] = { ...(data.guilds[guildId] || {}), ...patch };
    writeStore(data);
    return data.guilds[guildId];
}

function getGuildSettings(guildId) {
    return readStore().guilds[guildId] || {};
}

function addFavorite(userId, track) {
    const data = readStore();
    const list = data.users[userId]?.favorites || [];
    const key = track.uri || `${track.title}|${track.author}`;
    if (!list.some(item => (item.uri || `${item.title}|${item.author}`) === key)) {
        list.unshift({
            title: String(track.title || "Unknown track").slice(0, 180),
            author: String(track.author || "Unknown artist").slice(0, 120),
            uri: track.uri || null,
            thumbnail: track.thumbnail || null,
            length: Number(track.length || 0),
            savedAt: new Date().toISOString(),
        });
    }
    data.users[userId] = { ...(data.users[userId] || {}), favorites: list.slice(0, 100) };
    writeStore(data);
    return data.users[userId].favorites;
}

function getFavorites(userId) {
    return readStore().users[userId]?.favorites || [];
}

module.exports = { ensureStore, saveGuildSettings, getGuildSettings, addFavorite, getFavorites };
