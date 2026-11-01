const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const PURPLE = 0x7C3AED;
const DARK = 0x171923;

function formatDuration(ms) {
    if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return "LIVE";
    const total = Math.floor(Number(ms) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function getCurrentTrack(player) {
    return player?.queue?.current || player?.queue?.[0] || null;
}

function getUpcoming(player) {
    const queue = player?.queue;
    if (!queue) return [];
    if (Array.isArray(queue)) return queue.slice(0, 100);
    if (Array.isArray(queue.tracks)) return queue.tracks.slice(0, 100);
    if (typeof queue.toArray === "function") return queue.toArray().slice(0, 100);
    try { return Array.from(queue).slice(0, 100); } catch { return []; }
}

function getThumbnail(track) {
    if (track?.thumbnail) return track.thumbnail;
    if (track?.identifier && /youtube/i.test(track?.sourceName || "")) {
        return `https://img.youtube.com/vi/${encodeURIComponent(track.identifier)}/hqdefault.jpg`;
    }
    return null;
}

function nowPlayingEmbed(player, track) {
    const requester = track?.requester;
    const requesterName = requester?.tag || requester?.username || "Unknown";
    const source = track?.sourceName || "Music source";
    const embed = new EmbedBuilder()
        .setColor(PURPLE)
        .setAuthor({ name: "BauaaCore • Now Playing" })
        .setTitle(String(track?.title || "Unknown track").slice(0, 250))
        .setDescription([
            `**Artist:** ${String(track?.author || "Unknown artist").slice(0, 180)}`,
            `**Duration:** ${formatDuration(track?.length)}`,
            `**Requester:** ${requesterName}`,
            `**Source:** ${source}`,
            `**Volume:** ${player?.volume ?? 100}%  •  **Loop:** ${player?.loop || "none"}`,
        ].join("\n"))
        .setFooter({ text: "BAUAACORE MUSIC • Built by Bauaa 🖤" })
        .setTimestamp();
    if (track?.uri) embed.setURL(track.uri);
    const thumbnail = getThumbnail(track);
    if (thumbnail) embed.setThumbnail(thumbnail);
    return embed;
}

function nowPlayingButtons(guildId, paused = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`bc_music:pause:${guildId}`).setLabel(paused ? "Resume" : "Pause").setEmoji(paused ? "▶️" : "⏸️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bc_music:skip:${guildId}`).setLabel("Skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bc_music:shuffle:${guildId}`).setLabel("Shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`bc_music:stop:${guildId}`).setLabel("Stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`bc_music:like:${guildId}`).setLabel("Like").setEmoji("💜").setStyle(ButtonStyle.Success),
    );
}

function queuedEmbed({ track, requester, position, playlistName, playlistCount, playlistDuration }) {
    const isPlaylist = Boolean(playlistName);
    const embed = new EmbedBuilder()
        .setColor(DARK)
        .setAuthor({ name: isPlaylist ? "BauaaCore • Enqueued Playlist" : "BauaaCore • Enqueued Track" })
        .setDescription(isPlaylist
            ? `✅ Added **[${String(playlistName).slice(0, 180)}]** with **${playlistCount}** tracks to the queue.`
            : `✅ Added **[${String(track?.title || "Unknown track").slice(0, 180)}](${track?.uri || "https://discord.com"})** to the queue.`)
        .addFields(
            { name: "Requester", value: requester?.tag || requester?.username || "Unknown", inline: true },
            { name: "Position", value: String(position), inline: true },
            { name: "Duration", value: isPlaylist ? formatDuration(playlistDuration || 0) : formatDuration(track?.length), inline: true },
        )
        .setFooter({ text: "BAUAACORE MUSIC" })
        .setTimestamp();
    const thumbnail = getThumbnail(track);
    if (thumbnail) embed.setThumbnail(thumbnail);
    return embed;
}

function clearUpcoming(player) {
    const queue = player?.queue;
    if (!queue) return;
    if (typeof queue.clear === "function") queue.clear();
    else if (Array.isArray(queue)) queue.splice(0, queue.length);
}

function shuffleUpcoming(player) {
    const queue = player?.queue;
    if (!queue) return false;
    if (typeof queue.shuffle === "function") {
        queue.shuffle();
        return true;
    }
    if (Array.isArray(queue)) {
        for (let i = queue.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [queue[i], queue[j]] = [queue[j], queue[i]];
        }
        return true;
    }
    return false;
}

function simpleMusicEmbed(title, description) {
    return new EmbedBuilder().setColor(PURPLE).setTitle(title).setDescription(description).setFooter({ text: "BauaaCore Music" });
}

module.exports = { formatDuration, getCurrentTrack, getUpcoming, nowPlayingEmbed, nowPlayingButtons, queuedEmbed, simpleMusicEmbed, clearUpcoming, shuffleUpcoming };
