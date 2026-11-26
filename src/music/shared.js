const { escapeMarkdown } = require("discord.js");

class MusicError extends Error {}

const TRACK_LIMIT = 500;
const noMentions = { parse: [], repliedUser: false };
const ytDlpOptions = ["--ignore-config", "--no-warnings", "--js-runtimes", "node", "--no-playlist",
    "--socket-timeout", "10", "--retries", "1", "--extractor-retries", "1"];

function ytDlpErrorDetail(error) {
    const output = error.stderr?.toString() || "";
    const status = /\bHTTP Error (\d{3})\b/i.exec(output)?.[1];
    if (/sign in|login required/i.test(output)) return "upstream requested sign-in";
    if (error.killed) return "audio resolution timed out";
    if (status) return `upstream returned HTTP ${status}`;
    if (/requested format is not available/i.test(output)) return "no supported audio format returned";
    const lines = output.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const line = lines.findLast(value => /^ERROR:/i.test(value)) || lines.at(-1);
    return line?.replace(/^ERROR:\s*/i, "")
        .replace(/\bhttps?:\/\/[^\s<>]+/gi, "[url]")
        .replace(/\b(?:authorization|cookie|(?:access|refresh)[ _-]?token|token|password|api[ _-]?key|visitor[ _-]?data|signature)\s*[:=].*/gi, "[redacted]")
        .replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 240) || "audio resolution failed";
}

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

module.exports = { MusicError, TRACK_LIMIT, noMentions, ytDlpOptions, ytDlpErrorDetail, musicText, duration, trackTitle, trackLines, trackLink };
