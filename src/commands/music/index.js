const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js");
const { searchWithFallback } = require("../../music/resolver");
const { addFavorite, getFavorites } = require("../../music/store");
const { getCurrentTrack, getUpcoming, queuedEmbed, simpleMusicEmbed, formatDuration, clearUpcoming, shuffleUpcoming } = require("../../music/helpers");

function getPlayer(interaction) {
    return interaction.client.music?.players.get(interaction.guildId);
}

function requireVoice(interaction) {
    const channel = interaction.member?.voice?.channel;
    if (!channel) throw new Error("Join a voice channel first.");
    return channel;
}

async function getOrCreatePlayer(interaction, voiceChannel) {
    const manager = interaction.client.music;
    let player = manager.players.get(interaction.guildId);
    if (player) {
        if (player.voiceId !== voiceChannel.id) player.setVoiceChannel(voiceChannel.id);
        player.setTextChannel(interaction.channelId);
        return player;
    }
    return manager.createPlayer({
        guildId: interaction.guildId,
        voiceId: voiceChannel.id,
        textId: interaction.channelId,
        volume: 80,
        deaf: true,
    });
}

function command(name, description, execute, configure) {
    const builder = new SlashCommandBuilder().setName(name).setDescription(description);
    if (configure) configure(builder);
    return { data: builder, execute };
}

const commands = [];

commands.push(command("play", "Play a song or add a playlist to the music queue.", async interaction => {
    const query = interaction.options.getString("query", true).trim();
    const voice = requireVoice(interaction);
    await interaction.deferReply();
    const result = await searchWithFallback(interaction.client.music, query, interaction.user);
    if (!result.tracks?.length) return interaction.editReply("❌ No playable tracks found. Try a different link or search phrase.");

    const player = await getOrCreatePlayer(interaction, voice);
    const isPlaylist = result.type === "PLAYLIST";
    const tracks = isPlaylist ? result.tracks : [result.tracks[0]];
    const before = getUpcoming(player).length;
    player.queue.add(tracks);
    if (!player.playing && !player.paused) await player.play();

    const track = tracks[0];
    const embed = queuedEmbed({
        track,
        requester: interaction.user,
        position: before + 1,
        playlistName: isPlaylist ? (result.playlistName || "Playlist") : null,
        playlistCount: tracks.length,
        playlistDuration: tracks.reduce((total, item) => total + (Number(item.length) || 0), 0),
    });
    return interaction.editReply({ embeds: [embed] });
}, builder => builder.addStringOption(option => option.setName("query").setDescription("Song name, artist, or supported music URL").setRequired(true).setMaxLength(500))));

commands.push(command("pause", "Pause the current music.", async interaction => {
    const player = getPlayer(interaction);
    if (!player?.playing) return interaction.reply({ content: "Nothing is playing right now.", ephemeral: true });
    player.pause(true);
    return interaction.reply({ content: "⏸️ Music paused.", ephemeral: true });
}));

commands.push(command("resume", "Resume paused music.", async interaction => {
    const player = getPlayer(interaction);
    if (!player?.paused) return interaction.reply({ content: "Music is not paused.", ephemeral: true });
    player.pause(false);
    return interaction.reply({ content: "▶️ Music resumed.", ephemeral: true });
}));

commands.push(command("skip", "Skip the current track.", async interaction => {
    const player = getPlayer(interaction);
    if (!player?.playing) return interaction.reply({ content: "Nothing is playing.", ephemeral: true });
    player.skip();
    return interaction.reply({ content: "⏭️ Skipped the current track.", ephemeral: true });
}));

commands.push(command("stop", "Stop music and clear the server queue.", async interaction => {
    const player = getPlayer(interaction);
    if (!player) return interaction.reply({ content: "No music player is active.", ephemeral: true });
    clearUpcoming(player);
    await player.destroy();
    return interaction.reply({ content: "⏹️ Music stopped and queue cleared.", ephemeral: true });
}));

commands.push(command("queue", "Show the current music queue.", async interaction => {
    const player = getPlayer(interaction);
    if (!player) return interaction.reply({ content: "The music queue is empty.", ephemeral: true });
    const current = getCurrentTrack(player);
    const upcoming = getUpcoming(player);
    const lines = upcoming.slice(0, 10).map((track, index) => `**${index + 1}.** ${String(track.title).slice(0, 90)} — ${formatDuration(track.length)}`);
    const embed = simpleMusicEmbed("🎶 BauaaCore Queue", [
        current ? `**Now:** ${current.title} — ${formatDuration(current.length)}` : "No current track.",
        lines.length ? `\n**Up next**\n${lines.join("\n")}` : "\nNo upcoming tracks.",
        `\n**Upcoming tracks:** ${upcoming.length}`,
    ].join("\n"));
    return interaction.reply({ embeds: [embed], ephemeral: true });
}));

commands.push(command("nowplaying", "Show the currently playing track.", async interaction => {
    const player = getPlayer(interaction);
    const track = getCurrentTrack(player) || player?.data.get("currentTrack");
    if (!player || !track) return interaction.reply({ content: "Nothing is playing.", ephemeral: true });
    const message = player.data.get("nowPlayingMessage");
    if (message) return interaction.reply({ content: `Now Playing: ${message.url}`, ephemeral: true });
    return interaction.reply({ content: `🎵 **${track.title}** — ${track.author}\n${track.uri || ""}`, ephemeral: true });
}));

commands.push(command("volume", "Set the music volume (1–150%).", async interaction => {
    const player = getPlayer(interaction);
    if (!player) return interaction.reply({ content: "No active music player.", ephemeral: true });
    const volume = interaction.options.getInteger("amount", true);
    await player.setVolume(volume);
    return interaction.reply({ content: `🔊 Volume set to **${volume}%**.`, ephemeral: true });
}, builder => builder.addIntegerOption(option => option.setName("amount").setDescription("Volume percentage").setMinValue(1).setMaxValue(150).setRequired(true))));

commands.push(command("loop", "Set track or queue repeat mode.", async interaction => {
    const player = getPlayer(interaction);
    if (!player) return interaction.reply({ content: "No active music player.", ephemeral: true });
    const mode = interaction.options.getString("mode", true);
    player.setLoop(mode);
    return interaction.reply({ content: `🔁 Loop mode: **${mode}**.`, ephemeral: true });
}, builder => builder.addStringOption(option => option.setName("mode").setDescription("Repeat mode").setRequired(true).addChoices(
    { name: "Off", value: "none" }, { name: "Track", value: "track" }, { name: "Queue", value: "queue" },
))));

commands.push(command("shuffle", "Shuffle upcoming tracks.", async interaction => {
    const player = getPlayer(interaction);
    if (!player || getUpcoming(player).length < 2) return interaction.reply({ content: "Add at least two upcoming tracks first.", ephemeral: true });
    if (!shuffleUpcoming(player)) return interaction.reply({ content: "Queue shuffle is unavailable in this queue build.", ephemeral: true });
    return interaction.reply({ content: "🔀 Queue shuffled.", ephemeral: true });
}));

commands.push(command("connect", "Connect BauaaCore to your voice channel.", async interaction => {
    const voice = requireVoice(interaction);
    await getOrCreatePlayer(interaction, voice);
    return interaction.reply({ content: `🔊 Connected to **${voice.name}**.`, ephemeral: true });
}));

commands.push(command("disconnect", "Disconnect music player from voice.", async interaction => {
    const player = getPlayer(interaction);
    if (!player) return interaction.reply({ content: "I'm not connected to a voice channel.", ephemeral: true });
    await player.destroy();
    return interaction.reply({ content: "👋 Disconnected from voice.", ephemeral: true });
}));

commands.push(command("like", "Save the currently playing song to your favourites.", async interaction => {
    const player = getPlayer(interaction);
    const track = getCurrentTrack(player) || player?.data.get("currentTrack");
    if (!track) return interaction.reply({ content: "Nothing is playing to save.", ephemeral: true });
    const favorites = addFavorite(interaction.user.id, track);
    return interaction.reply({ content: `💜 Saved **${track.title}**. You have ${favorites.length} favourite(s).`, ephemeral: true });
}));

commands.push(command("favorites", "Show your saved favourite tracks.", async interaction => {
    const favorites = getFavorites(interaction.user.id);
    if (!favorites.length) return interaction.reply({ content: "You haven't saved any favourite tracks yet.", ephemeral: true });
    const lines = favorites.slice(0, 15).map((track, index) => `**${index + 1}.** ${track.uri ? `[${track.title}](${track.uri})` : track.title} — ${track.author}`);
    return interaction.reply({ embeds: [simpleMusicEmbed("💜 Your Favourite Tracks", lines.join("\n"))], ephemeral: true });
}));

async function handleMusicButton(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith("bc_music:")) return false;
    const [, action, guildId] = interaction.customId.split(":");
    if (guildId !== interaction.guildId) {
        await interaction.reply({ content: "This player belongs to another server.", ephemeral: true });
        return true;
    }
    const player = getPlayer(interaction);
    if (!player) {
        await interaction.reply({ content: "This music player is no longer active.", ephemeral: true });
        return true;
    }
    const memberVoice = interaction.member?.voice?.channelId;
    if (memberVoice && player.voiceId && memberVoice !== player.voiceId) {
        await interaction.reply({ content: "Join the same voice channel as the bot to control music.", ephemeral: true });
        return true;
    }
    switch (action) {
        case "pause":
            player.pause(!player.paused);
            await interaction.update({ components: [require("../../music/helpers").nowPlayingButtons(guildId, player.paused)] });
            return true;
        case "skip":
            player.skip();
            await interaction.reply({ content: "⏭️ Skipped.", ephemeral: true });
            return true;
        case "shuffle":
            if (getUpcoming(player).length > 1 && shuffleUpcoming(player)) {
                await interaction.reply({ content: "🔀 Queue shuffled.", ephemeral: true });
            } else await interaction.reply({ content: "Not enough upcoming tracks to shuffle.", ephemeral: true });
            return true;
        case "stop":
            clearUpcoming(player);
            await player.destroy();
            await interaction.update({ components: [] });
            return true;
        case "like": {
            const track = getCurrentTrack(player) || player.data.get("currentTrack");
            if (!track) await interaction.reply({ content: "Nothing is playing.", ephemeral: true });
            else {
                addFavorite(interaction.user.id, track);
                await interaction.reply({ content: `💜 Saved **${track.title}** to your favourites.`, ephemeral: true });
            }
            return true;
        }
        default:
            await interaction.reply({ content: "Unknown music control.", ephemeral: true });
            return true;
    }
}

module.exports = { commands, handleMusicButton };
