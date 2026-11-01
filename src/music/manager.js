const { Kazagumo } = require("kazagumo");
const { Connectors } = require("shoukaku");
const { nowPlayingEmbed, nowPlayingButtons, getCurrentTrack } = require("./helpers");

function createMusicManager(client) {
    const host = process.env.LAVALINK_HOST || "127.0.0.1";
    const port = Number(process.env.LAVALINK_PORT || 2333);
    const auth = process.env.LAVALINK_PASSWORD || "change-this-lavalink-password";
    const secure = String(process.env.LAVALINK_SECURE || "false").toLowerCase() === "true";

    const manager = new Kazagumo({
        defaultSearchEngine: "youtube",
        send: (guildId, payload) => {
            const guild = client.guilds.cache.get(guildId);
            if (guild) guild.shard.send(payload);
        },
    }, new Connectors.DiscordJS(client), [{
        name: "BauaaCore-Lavalink",
        url: `${host}:${port}`,
        auth,
        secure,
    }]);

    manager.shoukaku.on("ready", name => console.log(`[Lavalink] Node ready: ${name}`));
    manager.shoukaku.on("error", (name, error) => console.error(`[Lavalink] ${name} error:`, error));
    manager.shoukaku.on("close", (name, code, reason) => console.warn(`[Lavalink] ${name} closed (${code}): ${reason || "no reason"}`));
    manager.shoukaku.on("disconnect", name => console.warn(`[Lavalink] Node disconnected: ${name}`));

    manager.on("playerStart", async (player, track) => {
        try {
            const channel = await client.channels.fetch(player.textId).catch(() => null);
            if (!channel?.isTextBased()) return;
            const payload = {
                embeds: [nowPlayingEmbed(player, track)],
                components: [nowPlayingButtons(player.guildId, player.paused)],
            };
            const oldMessage = player.data.get("nowPlayingMessage");
            if (oldMessage) await oldMessage.edit({ components: [] }).catch(() => {});
            const message = await channel.send(payload);
            player.data.set("nowPlayingMessage", message);
            player.data.set("currentTrack", track);
        } catch (error) {
            console.error("[Music] Could not post Now Playing embed:", error);
        }
    });

    manager.on("playerEnd", async player => {
        const message = player.data.get("nowPlayingMessage");
        if (message) await message.edit({ components: [] }).catch(() => {});
    });

    manager.on("playerEmpty", player => {
        const channel = client.channels.cache.get(player.textId);
        if (channel?.isTextBased()) {
            channel.send({ embeds: [{ color: 0x7C3AED, description: "🎵 Queue finished. Add another track with `/play`." }] }).catch(() => {});
        }
    });

    manager.on("playerException", (player, data) => {
        console.error(`[Music] Playback exception in ${player.guildId}:`, data?.exception || data);
        const channel = client.channels.cache.get(player.textId);
        if (channel?.isTextBased()) channel.send("⚠️ This track could not be played. I'll continue with the next queued track if available.").catch(() => {});
        if (player.queue?.length) player.skip();
    });

    manager.on("playerStuck", (player, data) => {
        console.warn(`[Music] Track stuck in ${player.guildId}:`, data);
        if (player.queue?.length) player.skip();
    });

    return manager;
}

module.exports = { createMusicManager };
