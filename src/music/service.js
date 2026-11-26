const { createHash, randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");
const { ChannelType, PermissionFlagsBits, Routes } = require("discord.js");
const { LavalinkManager, TrackSymbol, UnresolvedTrackSymbol } = require("lavalink-client");
const { library } = require("./library");
const { createMediaCache } = require("./media");
const { customHosts, matchTrack, matchSoundCloudTrack, searchTracks, storeTrack, streamProvider, directProviderTrack } = require("./sources");
const { MusicError, TRACK_LIMIT, noMentions, trackTitle, ytDlpErrorDetail } = require("./shared");
const { playerPanel, disconnectedPanel } = require("./panel");
const filters = require("./filters");

function nodeOptions(env) {
    return ["", "_BACKUP"].flatMap((suffix, index) => {
        const authorization = env[`LAVALINK_PASSWORD${suffix}`];
        const address = env[`LAVALINK_URL${suffix}`] || (index ? "" : "http://127.0.0.1:2333");
        if (!authorization || !address) return [];
        const url = new URL(address);
        if (!["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
            throw new Error("LAVALINK_URL must be an HTTP or HTTPS origin.");
        }
        const secure = url.protocol === "https:";
        return [{ id: index ? "backup" : "primary", authorization, host: url.hostname,
            port: Number(url.port || (secure ? 443 : 80)), secure, requestSignalTimeoutMS: 12000, retryAmount: 1e6 }];
    });
}

function serial(map, key, action) {
    const pending = (map.get(key) || Promise.resolve()).then(action);
    const barrier = pending.catch(() => {});
    map.set(key, barrier);
    return pending.finally(() => {
        if (map.get(key) === barrier) map.delete(key);
    });
}

function assertVoice(interaction, channel) {
    if (!channel || ![ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type)) {
        throw new MusicError("Join a voice channel first.");
    }
    const permissions = channel.permissionsFor(interaction.guild.members.me);
    if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]) ||
        (channel.type === ChannelType.GuildVoice && !permissions.has(PermissionFlagsBits.Speak))) {
        throw new MusicError("I need View Channel, Connect and Speak permissions in that voice channel.");
    }
    if (channel.type === ChannelType.GuildStageVoice && !permissions.has([
        PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MuteMembers, PermissionFlagsBits.MoveMembers,
    ])) throw new MusicError("Make BauaaCore a Stage moderator so it can join as a speaker.");
    if (!channel.joinable) throw new MusicError("I can’t join that channel. Check its member limit and permissions.");
}

function createMusic(client, { env = process.env, data = library() } = {}) {
    let nodes;
    try {
        nodes = nodeOptions(env);
    } catch (error) {
        console.error("Music configuration:", error.message);
        nodes = [];
    }
    const mediaHosts = customHosts(env);
    const extractor = env.MUSIC_YTDLP_PATH?.trim();
    const media = createMediaCache(env.MUSIC_MEDIA_BASE_URL);
    const controls = new Map();
    const messages = new Map();
    const panels = new Map();
    const voiceWork = new Map();
    const activeVoice = new Map();
    const selections = new Map();
    const manager = nodes.length ? new LavalinkManager({
        nodes,
        sendToShard: (guildId, packet) => client.guilds.cache.get(guildId)?.shard.send(packet),
        autoSkip: true,
        autoSkipOnResolveError: true,
        catchLifeCycleRejections: true,
        playerOptions: {
            defaultSearchPlatform: "ytsearch",
            allowCustomSources: true,
            enforceSponsorBlockRequestForEventEnablement: false,
            onDisconnect: { destroyPlayer: true },
            onEmptyQueue: { autoPlayFunction: autoplay },
            maxErrorsPerTime: { threshold: 35000, maxAmount: 15 },
        },
        queueOptions: { maxPreviousTracks: 50 },
    }) : null;

    function warn(event, error) {
        console.warn(`[Music] ${event}`, error?.code || error?.name || "failed");
    }

    async function providerTrack(node, url, requester, info) {
        const provider = streamProvider(url);
        try {
            const track = await directProviderTrack(node, url, requester, extractor, undefined, media.load, info);
            if (!track) console.warn(`[Music] yt-dlp ${provider}: Lavalink could not load the resolved audio`);
            return track;
        } catch (error) {
            warn(`yt-dlp ${provider}: ${ytDlpErrorDetail(error)}`, error);
            return null;
        }
    }

    function playerFor(guildId) {
        return manager?.getPlayer(guildId);
    }

    function nodeFor(guildId) {
        const node = playerFor(guildId)?.node || manager?.nodeManager.leastUsedNodes().find(item => item.sessionId && item.info);
        if (!node?.connected || !node.sessionId || !node.info) {
            throw new MusicError(manager ? "The music server is offline. Try again in a moment." :
                "Music needs a Lavalink server. Ask the bot operator to configure `LAVALINK_PASSWORD`.");
        }
        return node;
    }

    function context(interaction) {
        const guild = interaction.guild;
        const member = guild.members.cache.get(interaction.user.id) || interaction.member;
        return { guild, member, userId: interaction.user.id, voice: guild.voiceStates.cache.get(interaction.user.id)?.channel,
            manager: Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) };
    }

    async function guard(interaction, command, { voice = false, player = false, manage = false } = {}) {
        const ctx = context(interaction);
        const settings = await data.settings(ctx.guild.id);
        const roles = ctx.member?.roles;
        const hasDj = settings.djRole && (roles?.cache?.has(settings.djRole) || roles?.includes?.(settings.djRole));
        if (manage && !ctx.manager) throw new MusicError("You need Manage Server to change music settings.");
        if (!ctx.manager && settings.restrictedChannels[interaction.channelId]?.includes(command)) {
            throw new MusicError("This music command is restricted in this channel.");
        }
        if (!ctx.manager && settings.djCommands.includes(command) && !hasDj) throw new MusicError("This control requires the DJ role.");
        const existing = playerFor(ctx.guild.id);
        if (player && !existing) throw new MusicError("There’s no active player. Start one with `/play`.");
        if (voice && !ctx.voice) throw new MusicError("Join a voice channel first.");
        if (voice && existing?.voiceChannelId && ctx.voice.id !== existing.voiceChannelId) {
            throw new MusicError("Join BauaaCore’s voice channel to use this control.");
        }
        return { ...ctx, settings, player: existing };
    }

    async function raw(packet) {
        if (!manager || !["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE", "CHANNEL_DELETE"].includes(packet.t)) return;
        const id = packet.d.guild_id;
        if (!playerFor(id) || (packet.t === "VOICE_STATE_UPDATE" && packet.d.user_id !== client.user?.id)) return;
        await serial(voiceWork, id, async () => {
            const player = playerFor(id);
            if (!player) return;
            const state = activeVoice.get(id) || {};
            activeVoice.set(id, state);
            if (packet.t === "VOICE_SERVER_UPDATE") {
                state.pending = packet.d.endpoint ? packet : null;
            } else {
                if (packet.t === "VOICE_STATE_UPDATE") {
                    state.channel = packet.d.channel_id;
                    if (!state.channel) state.pending = null;
                }
                await manager.sendRawData(packet);
            }
            if (state.pending && state.channel && (!state.expected || state.expected === state.channel) && player.voice?.sessionId) {
                const update = state.pending;
                state.pending = null;
                await manager.sendRawData(update);
                state.ready = state.channel;
                state.expected = null;
            }
        });
    }

    async function join(interaction, ctx, channel = ctx.voice, moving = false) {
        assertVoice(interaction, channel);
        let player = ctx.player;
        if (player && !moving) {
            nodeFor(ctx.guild.id);
            if (activeVoice.get(ctx.guild.id)?.ready === channel.id) return player;
        } else if (!player) {
            const node = nodeFor(ctx.guild.id);
            player = manager.createPlayer({ guildId: ctx.guild.id, voiceChannelId: channel.id,
                textChannelId: interaction.channelId, selfDeaf: true, volume: 70, node });
            player.setData("panelId", randomUUID());
        }
        activeVoice.set(ctx.guild.id, { expected: channel.id });
        try {
            if (moving) await player.changeVoiceState({ voiceChannelId: channel.id });
            else await player.connect();
            for (let attempts = 0; attempts < 80; attempts++) {
                if (playerFor(ctx.guild.id) !== player) break;
                if (activeVoice.get(ctx.guild.id)?.ready === channel.id) {
                    const voice = ctx.guild.voiceStates.cache.get(client.user.id);
                    if (channel.type === ChannelType.GuildStageVoice && voice?.suppress) await voice.setSuppressed(false);
                    if (ctx.settings.sponsors) await applySponsors(player, true).catch(error => warn("SponsorBlock", error));
                    scheduleIdle(player, ctx.settings);
                    return player;
                }
                await delay(150);
            }
            throw new MusicError("Discord voice did not connect in time. Check the Lavalink node and try `/connect` again.");
        } catch (error) {
            if (playerFor(ctx.guild.id) === player) await player.destroy("Voice connection failed").catch(inner => warn("voice cleanup", inner));
            throw error;
        }
    }

    async function lookup(guildId, query, userId, source) {
        const node = nodeFor(guildId);
        const requester = { id: userId };
        try {
            const result = await searchTracks(node, query, requester, { mediaHosts, source });
            if (result.tracks.length || !extractor || !streamProvider(query)) return result;
        } catch (error) {
            if (!extractor || !streamProvider(query)) throw error;
        }
        const track = await providerTrack(node, query, requester);
        if (!track) throw new MusicError("No playable audio found for that link. Try another track or `/playfile`.");
        return { tracks: [track] };
    }

    function unresolved(reference, userId, candidate = null, allowAlternateSource = false) {
        const requester = { id: userId };
        const track = manager.utils.buildUnresolvedTrack({ info: { ...reference,
            sourceName: reference.source, isSeekable: true } }, requester);
        track.userData = { musicReference: reference };
        track.resolve = async player => {
            let result = candidate;
            if (reference.kind === "match") {
                result = await matchTrack(player.node, reference, requester, extractor ? candidate => {
                    if (!streamProvider(candidate.info.uri)) return candidate;
                    return providerTrack(player.node, candidate.info.uri, requester, candidate.info);
                } : undefined);
            } else {
                const uri = result?.info.uri || reference.url;
                if (extractor && streamProvider(uri)) {
                    const playable = await providerTrack(player.node, uri, requester, result?.info);
                    if (playable) result = playable;
                    else if (allowAlternateSource && result?.info.sourceName === "youtube" &&
                        player.node.info?.sourceManagers?.includes("soundcloud")) {
                        const alternate = await matchSoundCloudTrack(player.node, result, requester);
                        if (alternate) {
                            result = alternate;
                            console.info("[Music] Using a matched SoundCloud track after YouTube audio resolution failed");
                        }
                    }
                }
                if (!result) result = (await searchTracks(player.node, reference.url, requester, { mediaHosts }).catch(() => null))?.tracks?.[0];
            }
            if (!result?.encoded) {
                player.queue.current = null;
                const error = new MusicError("No playable match was found for this track.");
                error.track = track;
                throw error;
            }
            delete track.resolve;
            delete track[UnresolvedTrackSymbol];
            Object.defineProperty(track, TrackSymbol, { value: true, configurable: true });
            Object.assign(track, result, { userData: { ...result.userData, musicReference: reference }, requester });
            return track;
        };
        return track;
    }

    async function enqueue(interaction, ctx, tracks, { stored = false, first = false, allowAlternateSource = false } = {}) {
        if (!tracks.length) throw new MusicError("No playable tracks found.");
        const capacity = TRACK_LIMIT - (ctx.player?.queue.tracks.length || 0);
        if (capacity <= 0) throw new MusicError(`The queue is full (${TRACK_LIMIT} upcoming tracks).`);
        const player = await join(interaction, ctx);
        if (player.getData("idle")) clearTimeout(player.getData("idle"));
        const queued = tracks.slice(0, capacity).map(track => {
            if (stored) return unresolved(track, ctx.userId);
            if (extractor && !track.userData?.musicExtracted && streamProvider(track.info.uri)) {
                return unresolved(storeTrack(track), ctx.userId, track, allowAlternateSource);
            }
            return track;
        });
        await player.queue.add(queued, first ? 0 : undefined);
        if (!player.playing && !player.queue.current) {
            try {
                await player.play({ paused: false });
            } catch (error) {
                if (player.queue.current && queued.includes(player.queue.current)) player.queue.current = null;
                player.queue.tracks = player.queue.tracks.filter(track => !queued.includes(track));
                await player.queue.utils.save();
                throw error;
            }
            if (!player.queue.current && !player.playing) {
                throw new MusicError("The player couldn’t find playable audio for those tracks.");
            }
        } else void refresh(player).catch(error => warn("queue panel", error));
        return { player, amount: queued.length, omitted: tracks.length - queued.length };
    }

    async function autoplay(player, track) {
        if (!player.getData("autoplay") || !track?.info?.author || track.info.isStream) return;
        try {
            const history = new Set([track, ...player.queue.previous].map(item => item.info.identifier));
            const { tracks } = await searchTracks(player.node, `${track.info.author} music`, { id: client.user.id });
            let next = tracks.find(item => !history.has(item.info.identifier) && !item.info.isStream);
            if (next && playerFor(player.guildId) === player && !player.queue.current && player.queue.tracks.length === 0 && player.getData("autoplay")) {
                if (extractor && streamProvider(next.info.uri)) next = unresolved(storeTrack(next), client.user.id, next);
                await player.queue.add(next);
            }
        } catch (error) {
            warn("autoplay", error);
        }
    }

    async function applySponsors(player, enabled) {
        if (!enabled) player.deleteData("sponsorSegments");
        if (!player.node.info?.plugins?.some(plugin => plugin.name === "sponsorblock-plugin")) {
            if (enabled && !extractor) throw new MusicError("Install the SponsorBlock plugin on this Lavalink server to enable sponsor skipping.");
            return;
        }
        if (enabled) await player.setSponsorBlock(["sponsor", "selfpromo"]);
        else await player.deleteSponsorBlock();
    }

    async function sponsorSegments(player) {
        const track = player.queue.current;
        const id = track?.info.identifier;
        if (!track?.userData?.musicExtracted || track.info.sourceName !== "youtube" || !/^[\w-]{11}$/.test(id)) return;
        const hash = createHash("sha256").update(id).digest("hex").slice(0, 4);
        const url = new URL(`https://sponsor.ajay.app/api/skipSegments/${hash}`);
        url.searchParams.set("categories", JSON.stringify(["sponsor", "selfpromo"]));
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        const results = response.ok ? await response.json() : [];
        const segments = results.find(item => item.videoID === id)?.segments || [];
        if (player.queue.current === track && playerFor(player.guildId) === player && (await data.settings(player.guildId)).sponsors) {
            player.setData("sponsorSegments", { track, segments: segments.filter(item => item.actionType === "skip")
                .map(item => item.segment.map(seconds => Math.round(seconds * 1000))) });
        }
    }

    async function status(player, title, previous = player.getData("statusChannel")) {
        const channel = client.channels.cache.get(player.voiceChannelId);
        const next = title && channel?.type === ChannelType.GuildVoice ? channel.id : null;
        if (previous && previous !== next) {
            await client.rest.put(Routes.channelVoiceStatus(previous), { body: { status: null } }).catch(error => warn("clear voice status", error));
            player.deleteData("statusChannel");
        }
        if (!next) return;
        await client.rest.put(Routes.channelVoiceStatus(next), { body: { status: title.slice(0, 90) } });
        player.setData("statusChannel", next);
    }

    async function refresh(player, announce = false) {
        return serial(messages, player.guildId, async () => {
            if (playerFor(player.guildId) !== player) return;
            const settings = await data.settings(player.guildId);
            const old = panels.get(player.guildId);
            const channelId = settings.announceChannel || player.textChannelId;
            const payload = playerPanel(player, player.getData("panelId"), settings.buttons);
            if (old && (old.channelId !== channelId || !settings.announce)) {
                try {
                    await old.delete();
                } catch (error) {
                    if (error.code !== 10008) {
                        warn("remove panel", error);
                        await old.edit(disconnectedPanel()).catch(() => {});
                    }
                }
                panels.delete(player.guildId);
            } else if (old) {
                try {
                    return await old.edit(payload);
                } catch (error) {
                    if (error.code !== 10008) {
                        warn("edit panel", error);
                        return null;
                    }
                    panels.delete(player.guildId);
                }
            }
            if (!announce || !settings.announce || !player.queue.current) return null;
            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel?.isSendable()) return null;
            const panel = await channel.send(payload);
            panels.set(player.guildId, panel);
            return panel;
        });
    }

    function scheduleIdle(player, settings) {
        clearTimeout(player.getData("idle"));
        if (settings.stay) return;
        const voice = client.channels.cache.get(player.voiceChannelId);
        const empty = !voice?.members.some(member => !member.user.bot);
        if (!empty && player.queue.current) return;
        const timer = setTimeout(() => {
            void serial(controls, player.guildId, async () => {
                if (playerFor(player.guildId) !== player) return;
                const latest = await data.settings(player.guildId);
                const channel = client.channels.cache.get(player.voiceChannelId);
                if (!latest.stay && (!player.queue.current || !channel?.members.some(member => !member.user.bot))) {
                    await player.destroy("Music idle timeout");
                }
            }).catch(error => warn("idle disconnect", error));
        }, 120000);
        timer.unref();
        player.setData("idle", timer);
    }

    async function sync(player, announce) {
        if (playerFor(player.guildId) !== player) return;
        const settings = await data.settings(player.guildId);
        scheduleIdle(player, settings);
        if (settings.sponsors && player.getData("sponsorSegments")?.track !== player.queue.current) {
            void sponsorSegments(player).catch(error => warn("SponsorBlock lookup", error));
        }
        const title = settings.voiceStatus ? player.queue.current?.info.title : null;
        await status(player, title).catch(error => warn("voice status", error));
        await refresh(player, announce);
    }

    async function reportTrackError(player, track) {
        const last = player.getData("errorNotice") || 0;
        if (Date.now() - last < 10000) return;
        player.setData("errorNotice", Date.now());
        const channel = await client.channels.fetch(player.textChannelId).catch(() => null);
        if (channel?.isSendable()) await channel.send({ content: `Couldn’t play **${trackTitle(track)}**. Try another source or an audio file.`, allowedMentions: noMentions });
    }

    function select(interaction, tracks) {
        const now = Date.now();
        for (const [id, value] of selections) if (value.expires <= now) selections.delete(id);
        if (selections.size >= 500) selections.delete(selections.keys().next().value);
        const id = randomUUID();
        selections.set(id, { tracks, userId: interaction.user.id, guildId: interaction.guildId, expires: now + 120000 });
        return id;
    }

    function selected(interaction, id) {
        const entry = selections.get(id);
        if (!entry || entry.expires <= Date.now() || entry.guildId !== interaction.guildId) throw new MusicError("This search expired. Run `/search` again.");
        if (entry.userId !== interaction.user.id) throw new MusicError("Only the person who started this search can select a track.");
        const track = entry.tracks[Number(interaction.values[0])];
        if (!track) throw new MusicError("That search result isn’t available.");
        return track;
    }

    async function repair(interaction, ctx) {
        const old = ctx.player;
        const current = old.queue.current;
        const tracks = [...old.queue.tracks];
        const previous = [...old.queue.previous];
        const { paused, position, volume, repeatMode } = old;
        const autoplay = old.getData("autoplay");
        const effect = old.getData("effect");
        await old.destroy("Repair music player").catch(error => warn("repair disconnect", error));
        for (let attempt = 0; attempt < 20 && ctx.guild.voiceStates.cache.get(client.user.id)?.channelId; attempt++) await delay(150);
        const player = await join(interaction, { ...ctx, player: null });
        await player.setVolume(volume);
        await player.setRepeatMode(repeatMode);
        player.setData("autoplay", autoplay);
        if (effect) await applyFilter(player, effect);
        player.queue.previous = previous;
        await player.queue.add(tracks);
        if (current) await player.play({ clientTrack: current, position: current.info.isSeekable ? position : 0, paused });
        else if (tracks.length) await player.play({ paused: false });
    }

    async function applyFilter(player, name) {
        const previous = player.getData("effect");
        const next = name === previous || name === "resetfilter" ? null : name;
        await player.node.updatePlayer({ guildId: player.guildId, playerOptions: { filters: filters[next] || {} } });
        player.setData("effect", next);
        return next;
    }

    client.on("raw", packet => { void raw(packet).catch(error => warn("voice packet", error)); });
    client.on("guildDelete", guild => panels.delete(guild.id));
    client.on("voiceStateUpdate", (oldState, newState) => {
        if (oldState.channelId === newState.channelId) return;
        const player = playerFor(newState.guild.id);
        if (!player || ![oldState.channelId, newState.channelId].includes(player.voiceChannelId)) return;
        void data.settings(player.guildId).then(settings => scheduleIdle(player, settings)).catch(error => warn("voice idle timer", error));
    });

    if (manager) {
        manager.nodeManager.on("error", (node, error) => {
            const status = /^Unexpected server response: (\d{3})$/.exec(error?.message)?.[1];
            warn(`node ${node.id}${status ? ` WebSocket HTTP ${status}` : ""}`, error);
        });
        manager.nodeManager.on("connect", node => console.log(`[Music] Lavalink ${node.id} connected`));
        manager.on("trackStart", player => {
            player.deleteData("votes");
            player.deleteData("sponsorSegments");
            void sync(player, true).catch(error => warn("track start", error));
        });
        manager.on("playerUpdate", (_, player) => {
            const active = player.getData("sponsorSegments");
            if (!active || active.track !== player.queue.current || player.paused || active.seeking) return;
            const segment = active.segments.find(([start, end]) => start <= player.position && player.position < end);
            if (!segment) return;
            active.seeking = true;
            void player.seek(Math.min(segment[1], active.track.info.duration - 1))
                .catch(error => warn("SponsorBlock seek", error)).finally(() => { active.seeking = false; });
        });
        manager.on("queueEnd", player => { void sync(player, false).catch(error => warn("queue end", error)); });
        manager.on("trackError", (player, track, cause) => { void reportTrackError(player, track || cause?.track).catch(error => warn("track error", error)); });
        manager.on("trackStuck", (player, track) => { void reportTrackError(player, track).catch(error => warn("track stuck", error)); });
        manager.on("playerMove", player => { void sync(player, false).catch(error => warn("voice move", error)); });
        manager.on("playerDestroy", player => {
            clearTimeout(player.getData("idle"));
            if (!playerFor(player.guildId)) activeVoice.delete(player.guildId);
            void status(player, null).catch(error => warn("voice status", error));
            void serial(messages, player.guildId, async () => {
                if (playerFor(player.guildId)) return;
                const panel = panels.get(player.guildId);
                if (!panel) return;
                try {
                    await panel.edit(disconnectedPanel());
                } catch (error) {
                    if (error.code === 10008) panels.delete(player.guildId);
                    else warn("reset panel", error);
                }
            }).catch(error => warn("reset panel", error));
        });
    }

    return {
        manager, data, guard, nodeFor, playerFor, join, enqueue, lookup, unresolved, refresh, sync, scheduleIdle,
        select, selected, consumeSelection: id => selections.delete(id), applyFilter, applySponsors, repair, storeTrack,
        serialize: (id, fn) => serial(controls, id, fn),
        voiceChannel: player => client.channels.cache.get(player.voiceChannelId),
        handleMedia: media.handleHttp,
        start: () => manager?.init({ id: client.user.id, username: "BauaaCore/1.0.0" }),
        close: () => manager?.nodeManager.disconnectAll(true, true),
    };
}

module.exports = { createMusic, nodeOptions };
