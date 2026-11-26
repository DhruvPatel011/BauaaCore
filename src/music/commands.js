const {
    ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} = require("discord.js");
const { createMusic } = require("./service");
const { createAccounts } = require("./accounts");
const { controls, playInput, playSelection, spotifySearch } = require("./playback");
const { collections } = require("./collections");
const { settingsCommand, toggles } = require("./settings");
const { prefix } = require("./panel");
const { MusicError, noMentions } = require("./shared");
const filters = require("./filters");

const option = (kind, name, description, rule = {}) => ({ kind, name, description, ...rule });
const string = (name, description, required = false, max = 2000) => option("String", name, description, { required, max });
const integer = (name, description, min, max, required = false) => option("Integer", name, description, { min, max, required });
const boolean = (name, description, required = false) => option("Boolean", name, description, { required });
const choice = (name, description, choices, required = false) => option("String", name, description, { required, choices });
const command = (name, description, ...options) => ({ name, description, options });
const group = (name, description, ...subs) => ({ name, description, subs });
const query = string("query", "Song name or supported music link", true);
const position = integer("position", "Track position in the list", 1, 500, true);
const page = integer("page", "Page number", 1, 50);
const seconds = integer("seconds", "Number of seconds, default 15", 1, 3600);
const enabled = boolean("enabled", "Turn this on or off");
const confirm = boolean("confirm", "Confirm clearing this data", true);
const name = string("name", "Name of the playlist", true, 60);
const targetCommand = string("command", "Music command name, for example skip", true, 40);
const textChannel = option("Channel", "channel", "Text channel", { types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] });
const voiceChannel = option("Channel", "channel", "Destination voice channel", { required: true, types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice] });

const definitions = [
    command("play", "Play a song or playlist from a name or link.", query, boolean("first", "Put the tracks at the front of the queue")),
    command("playfile", "Play an uploaded audio or video file.", option("Attachment", "file", "Audio or video attachment", { required: true })),
    command("search", "Search for tracks and choose a result.", query, choice("source", "Music search provider", { YouTube: "ytsearch", "YouTube Music": "ytmsearch", SoundCloud: "scsearch" })),
    command("searchalbum", "Find a Spotify album and queue its tracks.", query),
    command("searchartist", "Find a Spotify artist and queue their top tracks.", query),
    command("searchplaylist", "Find a Spotify playlist and queue its tracks.", query),
    command("connect", "Connect BauaaCore to your voice channel."),
    command("disconnect", "Disconnect BauaaCore from voice."),
    command("nowplaying", "Show the current track and playback controls."),
    command("pause", "Pause the current track."),
    command("resume", "Resume playback."),
    command("previous", "Play the previous track."),
    command("replay", "Restart the current track."),
    command("seek", "Jump to a position in the current track.", string("time", "Seconds, m:ss, or h:mm:ss", true, 20)),
    command("forward", "Move forward in the current track.", seconds),
    command("rewind", "Move backward in the current track.", seconds),
    command("skip", "Skip the current song."),
    command("skipto", "Skip to an upcoming track.", position),
    command("voteskip", "Vote to skip the current song or jump to a queued track.", { ...position, required: false }),
    command("stop", "Stop playback and clear the queue."),
    command("volume", "Show or change playback volume.", integer("level", "Volume from 0 to 150 percent", 0, 150)),
    command("loop", "Cycle repeat mode or choose a specific mode.", choice("mode", "Repeat mode", { Off: "off", Track: "track", Queue: "queue" })),
    command("autoplay", "Queue a recommendation when playback finishes.", enabled),
    command("queue", "View the upcoming tracks.", page),
    command("history", "View recently played tracks.", page),
    command("shuffle", "Shuffle upcoming tracks."),
    command("clear", "Clear upcoming tracks."),
    command("bump", "Move an upcoming track to the front of the queue.", position),
    group("move", "Move a queued track or move the player to another voice channel.",
        command("track", "Move a track to a different queue position.", position, integer("to", "New position", 1, 500, true)),
        command("bot", "Move the player to a different voice channel.", voiceChannel)),
    group("remove", "Remove a track or remove duplicate tracks.",
        command("track", "Remove a queued track.", position), command("duplicates", "Remove duplicate tracks from the queue.")),
    command("leavecleanup", "Remove queued requests from members who have left voice."),
    command("lyrics", "Look up lyrics for the current track."),
    command("grab", "Send the current track details to your DMs."),
    command("like", "Save the current track to your liked songs."),
    command("dislike", "Remove the current or most recent track from your liked songs.", boolean("previous", "Unlike the previously played track")),
    command("showliked", "View your liked songs.", page),
    command("playliked", "Queue your liked songs."),
    command("clearliked", "Clear your liked songs.", confirm),
    command("sortliked", "Sort your liked songs.", choice("by", "Field to sort by", { Title: "title", Artist: "author", Source: "source" }, true)),
    group("playlist", "Manage your saved playlists.",
        command("list", "List your playlists."), command("create", "Create a new playlist.", name),
        command("delete", "Delete a saved playlist.", name), command("view", "View tracks in a playlist.", name, page),
        command("play", "Queue a saved playlist.", name), command("addtrack", "Find a track or link and add it to a playlist.", name, query),
        command("removetrack", "Remove a track by its playlist position.", name, position),
        command("import", "Import a supported playlist or album link as a new playlist.", name, query),
        command("setcover", "Set a playlist cover image.", name, string("image", "Public HTTPS image link, or omit to clear it", false, 1000)),
        command("addnowplaying", "Save the current track to a playlist.", name), command("savequeue", "Save the player queue as a new playlist.", name)),
    ...Object.keys(filters).map(effect => command(effect, `Toggle the ${effect} audio effect.`)),
    command("resetfilter", "Clear the active audio effect."),
    command("247", "Configure whether BauaaCore stays in voice when idle.", enabled),
    command("announce", "Configure track announcements and their text channel.", enabled, textChannel, boolean("here", "Use this text channel for announcements")),
    command("buttons", "Configure buttons on player cards.", enabled),
    command("voicechannelstatus", "Show the current track in the voice channel status.", enabled),
    command("sponsorblock", "Configure skipping sponsor segments in YouTube videos.", enabled),
    group("settings", "View or reset this server’s music settings.",
        command("view", "Show this server’s music settings."), command("reset", "Reset this server’s music settings.", confirm)),
    group("dj", "Manage music DJ permissions.", command("info", "Show the DJ role and DJ-only commands."),
        command("setup", "Set the DJ role.", option("Role", "role", "DJ role", { required: true })),
        command("restrict", "Make a command DJ-only or remove the requirement.", targetCommand, enabled),
        command("reset", "Turn off DJ restrictions.")),
    command("restrictcommand", "Restrict a music command in a particular text channel.", targetCommand, textChannel, enabled),
    group("restrict", "Restrict a music command in a text channel.", command("channel", "Restrict a command in this or another text channel.", targetCommand, textChannel)),
    group("unrestrict", "Remove a music command restriction.", command("channel", "Enable a command in this or another text channel.", targetCommand, textChannel)),
    command("setprefix", "Set an optional text prefix for music commands.", string("value", "1 to 5 punctuation characters, or omit to disable", false, 5)),
    command("forcefix", "Reconnect the player and restore its queue."),
    command("switchaudionode", "Move the player to another configured audio server."),
    command("debug", "Show diagnostics about the music player and its audio node."),
    command("speak", "Queue text-to-speech in your voice channel.", string("text", "What BauaaCore should read aloud", true, 250)),
    group("spotify", "Connect Spotify to access your playlists.", command("login", "Authorize BauaaCore to see your Spotify playlists."),
        command("logout", "Remove the saved Spotify connection."), command("playlists", "List your Spotify playlists or queue a playlist by ID.", string("id", "Spotify playlist ID", false, 22), page)),
    group("lastfm", "Connect Last.fm and optionally scrobble music.", command("login", "Start or finish Last.fm authorization."),
        command("logout", "Remove the saved Last.fm connection."), command("scrobble", "Enable or disable Last.fm scrobbling.", enabled)),
    group("music", "Get help and status for BauaaCore music.", command("help", "List music commands."), command("ping", "Show Discord gateway latency."),
        command("invite", "Get the BauaaCore installation link."), command("statistics", "View music player statistics.")),
];

const commandsByName = new Map(definitions.map(item => [item.name, item]));
const controlButtons = new Set(["previous", "rewind", "toggle", "forward", "skip", "queue", "shuffle", "loop", "autoplay", "stop",
    "quieter", "louder", "like", "lyrics", "grab", "replay", "dislike", "voteskip", "disconnect"]);
const quietActions = new Set([
    "play", "playfile", "search", "searchalbum", "searchartist", "searchplaylist", "connect", "disconnect",
    "pause", "resume", "toggle", "previous", "replay", "seek", "forward", "rewind", "skip", "skipto", "voteskip",
    "stop", "volume", "quieter", "louder", "loop", "autoplay", "shuffle", "clear", "bump", "move track", "move bot",
    "remove track", "remove duplicates", "leavecleanup", "like", "dislike", "grab", "playliked", "playlist play",
    "spotify playlists", "speak", "forcefix", "switchaudionode", "resetfilter", ...Object.keys(filters),
]);

function showSuccess(command, options, result) {
    if (typeof result !== "string") return true;
    if (command === "volume" && options.level == null) return true;
    if (command === "spotify" && options.sub === "playlists" && !options.id) return true;
    return !quietActions.has(options.sub ? `${command} ${options.sub}` : command);
}

function applyOptions(builder, options) {
    for (const item of options) builder[`add${item.kind}Option`](input => {
        input.setName(item.name).setDescription(item.description).setRequired(Boolean(item.required));
        if (item.kind === "Integer") input.setMinValue(item.min).setMaxValue(item.max);
        if (item.max && item.kind === "String") input.setMaxLength(item.max);
        if (item.choices) input.addChoices(...Object.entries(item.choices).map(([name, value]) => ({ name, value })));
        if (item.types) input.addChannelTypes(...item.types);
        return input;
    });
    return builder;
}

function slashData(item) {
    const builder = new SlashCommandBuilder().setName(item.name).setDescription(item.description).setContexts(InteractionContextType.Guild);
    if (!item.subs) return applyOptions(builder, item.options);
    for (const sub of item.subs) builder.addSubcommand(input => applyOptions(input.setName(sub.name).setDescription(sub.description), sub.options));
    return builder;
}

function slashOptions(interaction, command) {
    const sub = command.subs && interaction.options.getSubcommand();
    const selected = sub ? command.subs.find(item => item.name === sub) : command;
    return { sub, ...Object.fromEntries(selected.options.map(item => [item.name, interaction.options[`get${item.kind}`](item.name)])) };
}

function prefixOptions(definition, args, message) {
    const sub = definition.subs && args.shift()?.toLowerCase();
    const selected = definition.subs ? definition.subs.find(item => item.name === sub) : definition;
    if (!selected) throw new MusicError(`Choose one of ${definition.subs.map(item => `\`${item.name}\``).join(", ")}.`);
    const options = { sub };
    for (const [index, item] of selected.options.entries()) {
        let value = args.shift();
        if (item.kind === "Attachment") value = message.attachments.first();
        else if (item.kind === "Integer" && value != null) {
            value = Number(value);
            if (!Number.isInteger(value) || value < item.min || value > item.max) throw new MusicError(`Use a number from ${item.min} to ${item.max} for \`${item.name}\`.`);
        } else if (item.kind === "Boolean" && value != null) {
            if (!/^(?:true|false|on|off)$/i.test(value)) throw new MusicError(`Use \`true\` or \`false\` for \`${item.name}\`.`);
            value = /^(?:true|on)$/i.test(value);
        } else if (item.kind === "Channel" && value) {
            value = message.guild.channels.cache.get(value.replace(/[<#>]/g, ""));
            if (!value || !item.types.includes(value.type)) throw new MusicError("Mention a channel of the requested type.");
        } else if (item.kind === "Role" && value) {
            value = message.guild.roles.cache.get(value.replace(/[<@&>]/g, ""));
        } else if (item.kind === "String" && value) {
            const rest = item.name === "query" || item.name === "text" || (index === selected.options.length - 1 && !item.choices);
            if (rest && args.length) value = [value, ...args.splice(0)].join(" ");
            if (item.choices && !Object.values(item.choices).includes(value)) throw new MusicError(`Choose ${Object.values(item.choices).join(", ")} for \`${item.name}\`.`);
            if (item.max && value.length > item.max) throw new MusicError(`Keep \`${item.name}\` under ${item.max} characters.`);
        }
        if (item.required && value == null) throw new MusicError(`Provide \`${item.name}\`.`);
        options[item.name] = value;
    }
    return options;
}

function display(result) {
    return typeof result === "string" ? { content: result, allowedMentions: noMentions } : { ...result, allowedMentions: noMentions };
}

function installMusic(client, deps) {
    const music = createMusic(client, deps);
    const accounts = createAccounts(music, deps?.env);

    async function run(interaction, command, options) {
        if (["play", "playfile", "search"].includes(command)) return playInput(music, interaction, command, options);
        if (["searchartist", "searchplaylist", "searchalbum"].includes(command)) return spotifySearch(music, interaction, command, options.query);
        if (["playlist", "showliked", "playliked", "clearliked", "sortliked"].includes(command)) return collections(music, interaction, command, options);
        if (Object.hasOwn(toggles, command) || ["settings", "dj", "restrictcommand", "restrict", "unrestrict", "setprefix"].includes(command)) {
            return settingsCommand(music, interaction, command, options, commandsByName);
        }
        if (command === "spotify") return accounts.spotify(interaction, options);
        if (command === "lastfm") return accounts.lastfm(interaction, options);
        if (command === "speak") {
            const ctx = await music.guard(interaction, command, { voice: true });
            const node = music.nodeFor(ctx.guild.id);
            if (!node.info?.sourceManagers?.includes("flowery-tts")) throw new MusicError("Voice text-to-speech needs the Flowery TTS source on Lavalink.");
            const result = await node.search({ query: encodeURIComponent(options.text), source: "ftts" }, { id: ctx.userId });
            await music.enqueue(interaction, ctx, result.tracks.slice(0, 1));
            return "Queued your text-to-speech message.";
        }
        if (command === "debug") {
            const ctx = await music.guard(interaction, command);
            const player = ctx.player;
            const node = music.nodeFor(ctx.guild.id);
            return `Audio node · ${node.id}\nLavalink · ${node.info?.version?.semver || "ready"}\nVoice · ${player?.connected ? "Connected" : "Idle or connecting"}\nTracks queued · ${player?.queue.tracks.length || 0}\nSources · ${node.info?.sourceManagers?.join(", ") || "Unknown"}`;
        }
        if (command === "music") {
            await music.guard(interaction, command);
            if (options.sub === "ping") return `Discord gateway · ${Math.round(client.ws.ping)} ms`;
            if (options.sub === "invite") return `[Add BauaaCore to Discord](https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot%20applications.commands)`;
            if (options.sub === "statistics") return `Active music players · ${music.manager?.players.size || 0}\nConnected audio nodes · ${music.manager?.nodeManager.leastUsedNodes().length || 0}`;
            return `**BauaaCore music**\n${definitions.map(item => `\`/${item.name}\``).join(" · ")}\nTry \`/play\` with a song name or URL. Use \`/nowplaying\` for the player buttons.`;
        }
        const result = await controls(music, interaction, command, options);
        const player = music.playerFor(interaction.guildId);
        if (command === "nowplaying" && player) {
            const panel = await music.refresh(player, true).catch(() => null);
            if (panel?.url && (panel.channelId === interaction.channelId ||
                panel.channel?.permissionsFor(interaction.user.id)?.has(PermissionFlagsBits.ViewChannel))) {
                return `[Open the music controller](${panel.url})`;
            }
        }
        if (player && !["queue", "history", "nowplaying", "lyrics"].includes(command)) void music.refresh(player).catch(() => {});
        return result;
    }

    function errorReply(error, command) {
        if (error instanceof MusicError) return error.message;
        console.warn(`[Music] ${command}`, error?.code || error?.name || "failed");
        return "The music command failed. Try again or check `/debug`.";
    }

    const commands = definitions.map(item => ({ data: slashData(item), async execute(interaction) {
        if (!interaction.inGuild()) return interaction.reply({ content: "Run this command in a server.", flags: MessageFlags.Ephemeral });
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        try {
            const options = slashOptions(interaction, item);
            const result = await music.serialize(interaction.guildId, () => run(interaction, item.name, options));
            if (showSuccess(item.name, options, result)) await interaction.editReply(display(result));
            else await interaction.deleteReply().catch(() => {});
        } catch (error) {
            await interaction.editReply(display(errorReply(error, item.name)));
        }
    } }));

    async function component(interaction) {
        if (!interaction.inGuild() || !interaction.customId?.startsWith(prefix)) return;
        const [action, id] = interaction.customId.slice(prefix.length).split(":");
        if (interaction.isStringSelectMenu() && action === "select") {
            await interaction.deferUpdate();
            try {
                await music.serialize(interaction.guildId, () => playSelection(music, interaction, id));
                await interaction.deleteReply().catch(() => interaction.editReply({ components: [] }).catch(() => {}));
            } catch (error) {
                await interaction.followUp({ ...display(errorReply(error, action)), flags: MessageFlags.Ephemeral });
            }
            return;
        }
        if (!interaction.isButton() || !controlButtons.has(action)) return;
        await interaction.deferUpdate();
        try {
            const result = await music.serialize(interaction.guildId, async () => controls(music, interaction, action, { panelId: id,
                paused: music.playerFor(interaction.guildId)?.paused }));
            const player = music.playerFor(interaction.guildId);
            if (player) void music.refresh(player).catch(() => {});
            if (interaction.message.flags.has(MessageFlags.Ephemeral)) {
                if (!player || action === "stop") {
                    await interaction.deleteReply().catch(() => interaction.editReply({ components: [] }).catch(() => {}));
                } else {
                    const view = await controls(music, interaction, "nowplaying").catch(() => null);
                    if (view) await interaction.editReply(view).catch(() => {});
                }
            }
            if (showSuccess(action, {}, result)) await interaction.followUp({ ...display(result), flags: MessageFlags.Ephemeral });
        } catch (error) {
            await interaction.followUp({ ...display(errorReply(error, action)), flags: MessageFlags.Ephemeral });
        }
    }

    async function message(message) {
        if (!message.inGuild() || message.author.bot) return false;
        const candidate = /^[!?.~$+%#&;:]{1,5}\s*([a-z0-9]+)\b/i.exec(message.content);
        if (!candidate || !commandsByName.has(candidate[1].toLowerCase())) return false;
        const config = await music.data.settings(message.guild.id);
        if (!config.prefix || !message.content.startsWith(config.prefix)) return false;
        const [rawName, ...args] = message.content.slice(config.prefix.length).trim().match(/"[^"\n]*"|\S+/g)?.map(part => part.replace(/^"(.*)"$/, "$1")) || [];
        const item = commandsByName.get(rawName?.toLowerCase());
        if (!item) return false;
        const interaction = { guild: message.guild, guildId: message.guild.id, channelId: message.channelId,
            user: message.author, member: message.member, memberPermissions: message.member?.permissions };
        try {
            const options = prefixOptions(item, args, message);
            const result = await music.serialize(message.guild.id, () => run(interaction, item.name, options));
            if (!showSuccess(item.name, options, result)) return true;
            if (["spotify", "lastfm", "showliked", "playlist"].includes(item.name) && (item.name !== "playlist" || ["list", "view"].includes(options.sub))) {
                await message.author.send(display(result));
                await message.reply(display("Check your DMs for the result."));
            } else await message.reply(display(result));
        } catch (error) {
            await message.reply(display(errorReply(error, item.name)));
        }
        return true;
    }

    return { ...music, commands, component, message,
        handleHttp: (req, res) => accounts.handleHttp(req, res) || music.handleMedia(req, res) };
}

module.exports = { installMusic, definitions, slashData };
