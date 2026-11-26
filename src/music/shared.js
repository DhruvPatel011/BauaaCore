const { escapeMarkdown } = require("discord.js");

class MusicError extends Error {}

const TRACK_LIMIT = 500;
const noMentions = { parse: [], repliedUser: false };
const ytDlpOptions = ["--ignore-config", "--no-warnings", "--js-runtimes", "node", "--no-playlist",
    "--socket-timeout", "10", "--retries", "1", "--extractor-retries", "1"];

function musicText(value, limit = 100) {
    return escapeMarkdown(String(value || "Unknown").replace(/[\r\n\t]+/g, " ").slice(0, limit));
}

function duration(ms) {
    const seconds = Math.max(0, Math.floor((ms || 0) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const rest = String(seconds % 60).padStart(2, "0");
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

function trackTitle(track) {
    return musicText(track?.info?.title, 95);
}

function trackLines(tracks, page = 1) {
    const size = 10;
    const last = Math.max(1, Math.ceil(tracks.length / size));
    const current = Math.min(last, Math.max(1, page));
    const start = (current - 1) * size;
    const rows = tracks.slice(start, start + size).map((track, index) => {
        return `**${start + index + 1}.** ${trackTitle(track)} · ${musicText(track.info.author, 45)}`;
    });
    return { current, last, body: rows.join("\n") || "No tracks yet." };
}

function trackLink(track) {
    const uri = track?.info?.uri ?? track?.userData?.musicReference?.url;
    if (!uri) return null;
    try {
        const url = new URL(uri);
        return ["http:", "https:"].includes(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

module.exports = { MusicError, TRACK_LIMIT, noMentions, ytDlpOptions, musicText, duration, trackTitle, trackLines, trackLink };
