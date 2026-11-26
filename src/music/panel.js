const {
    ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
} = require("discord.js");
const { duration, musicText, trackTitle, trackLink, trackLines, noMentions } = require("./shared");

const prefix = "bauaa:music:";
const color = 0x8B5CF6;

function button(action, label, id, style = ButtonStyle.Secondary) {
    return new ButtonBuilder().setCustomId(`${prefix}${action}:${id}`).setLabel(label).setStyle(style);
}

function playerPanel(player, id, buttons = true) {
    const track = player.queue.current;
    const state = player.paused ? "Paused" : "Now playing";
    const status = track?.info.isStream ? "Live" : `${duration(player.position)} / ${duration(track?.info.duration)}`;
    const embed = new EmbedBuilder().setColor(color).setTitle(track ? state : "Music player")
        .setDescription(track ? `**${trackTitle(track)}**\n${musicText(track.info.author)}\n${status}` : "The queue is empty. Use `/play` to add music.");
    const info = track?.info;
const reference = track?.userData?.musicReference;

const artworkUrl = [
    info?.artworkUrl,
    info?.thumbnail,
    info?.thumbnailUrl,
    reference?.artworkUrl,
    reference?.thumbnail,
    info?.sourceName === "youtube" && /^[\w-]{11}$/.test(info.identifier)
        ? `https://i.ytimg.com/vi/${info.identifier}/hqdefault.jpg`
        : null,
].find(url => typeof url === "string" && /^https?:\/\//i.test(url));

if (artworkUrl) {
    embed.setThumbnail(artworkUrl);
}
    embed.setFooter({
        text: `${player.volume}% volume · ${player.queue.tracks.length} queued · Loop ${player.repeatMode} · Autoplay ${player.getData("autoplay") ? "on" : "off"}`,
    });
    const rows = [];
    if (buttons && track) {
        rows.push(new ActionRowBuilder().addComponents(
            button("previous", "Previous", id),
            button("toggle", player.paused ? "Resume" : "Pause", id, ButtonStyle.Primary),
            button("skip", "Skip", id), button("replay", "Replay", id),
        ));
        rows.push(new ActionRowBuilder().addComponents(
            button("queue", "Queue", id), button("shuffle", "Shuffle", id), button("loop", "Loop", id),
            button("autoplay", "Autoplay", id),
        ));
        rows.push(new ActionRowBuilder().addComponents(
            button("like", "Like", id, ButtonStyle.Success), button("dislike", "Unlike", id),
            button("lyrics", "Lyrics", id), button("grab", "Save DM", id),
        ));
        const finalRow = new ActionRowBuilder().addComponents(button("voteskip", "Vote skip", id));
        const href = trackLink(track);
        if (href && href.length <= 512) {
            finalRow.addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(href).setLabel("Open"));
        }
        rows.push(finalRow.addComponents(
            button("stop", "Stop", id, ButtonStyle.Danger), button("disconnect", "Leave", id, ButtonStyle.Danger),
        ));
    }
    return { embeds: [embed], components: rows, allowedMentions: noMentions };
}

function searchPanel(tracks, id, title = "Select a track") {
    const options = tracks.slice(0, 10).map((track, index) => ({
        label: String(track.info.title || "Unknown track").slice(0, 100),
        description: `${track.info.author || "Unknown artist"} · ${duration(track.info.duration)}`.slice(0, 100),
        value: String(index),
    }));
    return {
        content: title,
        components: [new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
            .setCustomId(`${prefix}select:${id}`).setPlaceholder("Choose a result").addOptions(options))],
        allowedMentions: noMentions,
    };
}

function disconnectedPanel() {
    return {
        embeds: [new EmbedBuilder().setColor(color).setTitle("Music player").setDescription("Join a voice channel and use `/play` to start music.")],
        components: [],
        allowedMentions: noMentions,
    };
}

function listPanel(title, tracks, page = 1, cover = null) {
    const { current, last, body } = trackLines(tracks, page);
    const embed = new EmbedBuilder().setColor(color).setTitle(title.slice(0, 256)).setDescription(body)
        .setFooter({ text: `${tracks.length} tracks · Page ${current} of ${last}` });
    if (cover) embed.setThumbnail(cover);
    return { embeds: [embed], allowedMentions: noMentions };
}

module.exports = { prefix, playerPanel, disconnectedPanel, searchPanel, listPanel };
