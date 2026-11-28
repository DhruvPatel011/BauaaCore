const { createHash, randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { ChannelType, PermissionFlagsBits, Routes } = require("discord.js");
const { LavalinkManager, Player, TrackSymbol, UnresolvedTrackSymbol } = require("lavalink-client");
const { sanitizeSingleLine } = require("../ai/contentFilters");
const { log } = require("../utils/runtimeLog");
const { library } = require("./library");
const { createMediaCache } = require("./media");
const { probeLavalink } = require("./nodeReadiness");
const { audioStage, lookupBudget, playbackBudget } = require("./audioDeadline");
const { checkedQuery, customHosts, isDirectMediaUrl, nativeMediaExtension, matchTrack, matchSoundCloudTrack,
    searchTracks, storeTrack, streamProvider, directProviderTrack, extractSearch } = require("./sources");
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

class MusicPlayer extends Player {
    play(options) {
        // lavalink-client's TrackStuck handler advances with the client track
        // in the raw track option. Preserve the queue object and its plan.
        const track = options?.track;
        if (track && track === this.queue.current && !options.clientTrack && this.LavalinkManager.utils.isTrack(track)) {
            return super.play({ ...options, clientTrack: track });
        }
        return super.play(options);
    }
}

function createMusic(client, { env = process.env, data = library(), enabled = true, onNodeReady, extractExec } = {}) {
    const embedded = env.BAUAA_EMBEDDED_LAVALINK === "1";
    const startupDeadline = Date.now() + 3 * 60_000;
    let audioConnected = false;
    let nodes;
    try {
        nodes = enabled ? nodeOptions(env) : [];
    } catch (error) {
        log("ERROR", "Audio Node", "Configuration error.", error);
        nodes = [];
    }
    const embeddedPrimary = embedded ? nodes.find(node => node.id === "primary") : undefined;
    const startup = embeddedPrimary ? new AbortController() : null;
    const mediaHosts = customHosts(env);
    const extractor = env.MUSIC_YTDLP_PATH?.trim();
    const media = createMediaCache(env.MUSIC_MEDIA_BASE_URL, extractExec);
    const controls = new Map();
    const messages = new Map();
    const panels = new Map();
    const voiceWork = new Map();
    const activeVoice = new Map();
    const selections = new Map();
    const connectionErrors = new Map();
    const readyNodes = new WeakSet();
    const sessions = new WeakMap();
    const playbackPlans = new WeakMap();
    const startingPlayers = new WeakMap();
    const startupTracks = new WeakSet();
    const endedTracks = new WeakSet();
    const shutdown = new AbortController();
    let hostedSearch;
    const manager = nodes.length ? new LavalinkManager({
        nodes: nodes.filter(node => node !== embeddedPrimary),
        playerClass: MusicPlayer,
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

    function isLoopbackNode(node) {
        return !node.options.secure && ["127.0.0.1", "localhost"].includes(node.options.host);
    }

    async function providerTrack(node, url, requester, info, signal, cacheOnly = false) {
        const provider = streamProvider(url);
        try {
            const track = await directProviderTrack(node, url, requester, extractor, extractExec,
                media.load, info, media.loadHls,
                { preferDirect: !embedded && isLoopbackNode(node), cacheOnly, signal });
            if (!track && !cacheOnly && !signal?.aborted) console.warn(`[Music] yt-dlp ${provider}: Lavalink could not load the resolved audio`);
            return track;
        } catch (error) {
            if (!signal?.aborted) warn(`yt-dlp ${provider}: ${ytDlpErrorDetail(error)}`, error);
            return null;
        }
    }

    function startSoundCloudSearch(ctx, query) {
        if (!embedded || !extractor || hostedSearch || ctx.player?.playing || ctx.player?.getData("audioTransition") || ctx.player?.queue.current ||
            ctx.player?.queue.tracks.length || typeof checkedQuery(query, mediaHosts) !== "string") return;
        const controller = new AbortController();
        const signal = AbortSignal.any([shutdown.signal, ctx.audioSignal, controller.signal]);
        const search = {
            signal,
            entries: extractSearch(extractor, `scsearch4:${query.trim()}`, signal, extractExec).catch(error => {
                if (!signal.aborted) warn(`SoundCloud search: ${ytDlpErrorDetail(error)}`, error);
                return [];
            }),
            cancel() {
                controller.abort();
                if (hostedSearch === search) hostedSearch = undefined;
            },
        };
        hostedSearch = search;
        return search;
    }

    function findSoundCloud(node, original, requester, signal, search) {
        return matchSoundCloudTrack(node, original, requester, {
            binary: extractor, exec: extractExec, signal, search,
            resolve: (url, info) => providerTrack(node, url, requester, info, signal),
        }).catch(error => {
            if (!signal.aborted) warn(`SoundCloud fallback: ${ytDlpErrorDetail(error)}`, error);
            return null;
        });
    }

    function playerFor(guildId) {
        return manager?.getPlayer(guildId);
    }

    function isReadyNode(node) {
        return Boolean(node?.connected && readyNodes.has(node));
    }

    function availableNode() {
        return manager?.nodeManager.leastUsedNodes().find(isReadyNode);
    }

    function audioStatus() {
        if (!enabled) return "disabled";
        if (!manager) return "unconfigured";
        if (availableNode()) {
            audioConnected = true;
            return "connected";
        }
        return embedded && !audioConnected && Date.now() < startupDeadline ? "starting" : "offline";
    }

    async function start() {
        if (!manager) return;
        const identity = { id: client.user.id, username: "BauaaCore/1.0.0" };
        if (!embeddedPrimary) return manager.init(identity);

        // An external backup can connect while the embedded JVM is starting.
        if (manager.nodeManager.nodes.size) await manager.init(identity);
        const { signal } = startup;
        const { host, port, secure, authorization } = embeddedPrimary;
        const origin = `${secure ? "https" : "http"}://${host}:${port}`;
        let ready = false;
        while (!signal.aborted && Date.now() < startupDeadline) {
            const response = await probeLavalink(origin, authorization, AbortSignal.any([signal, AbortSignal.timeout(2_000)]));
            if (response?.status === 401 || response?.status === 403) {
                throw new Error("Embedded Lavalink rejected its password. Check the Render Lavalink logs.");
            }
            if (response?.ok) {
                ready = true;
                break;
            }
            await delay(2_000, undefined, { signal }).catch(() => {});
        }
        if (signal.aborted) return;
        if (!ready) log("WARNING", "Audio Node", "Embedded Lavalink did not become ready in 3 minutes. Connection retries will continue. Check the Render Lavalink logs.");

        const node = manager.nodeManager.createNode(embeddedPrimary);
        if (manager.initiated) node.connect();
        else await manager.init(identity);
    }

    function nodeFor(guildId) {
        const node = playerFor(guildId)?.node || availableNode();
        if (!isReadyNode(node)) {
            if (audioStatus() === "starting") {
                throw new MusicError("The music server is starting up. Try again once `/debug` shows a connected audio node.");
            }
            throw new MusicError(manager ? "The music server is offline. Try again in a moment." :
                "Music needs a Lavalink server. Ask the bot operator to configure `LAVALINK_PASSWORD`.");
        }
        audioConnected = true;
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
        if (!manager || shutdown.signal.aborted || !["VOICE_STATE_UPDATE", "VOICE_SERVER_UPDATE", "CHANNEL_DELETE"].includes(packet.t)) return;
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
                if (playerFor(id) !== player || activeVoice.get(id) !== state) return;
                state.ready = state.channel;
                state.expected = null;
            }
        });
    }

    async function join(interaction, ctx, channel = ctx.voice, moving = false) {
        shutdown.signal.throwIfAborted();
        ctx.audioSignal?.throwIfAborted();
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
                await delay(150, undefined, { signal: ctx.audioSignal });
            }
            throw new MusicError("Discord voice did not connect in time. Check the Lavalink node and try `/connect` again.");
        } catch (error) {
            if (playerFor(ctx.guild.id) === player) await player.destroy("Voice connection failed").catch(inner => warn("voice cleanup", inner));
            throw error;
        }
    }

    async function lookup(guildId, query, userId, source, parent, soundCloudSearch) {
        const node = nodeFor(guildId);
        const requester = { id: userId };
        const input = checkedQuery(query, mediaHosts);
        if (input instanceof URL && isDirectMediaUrl(input, mediaHosts)) {
            if (media.filesEnabled) {
                const filename = input.pathname.split("/").at(-1);
                let title = filename;
                try { title = decodeURIComponent(filename); } catch { /* Keep the encoded filename. */ }
                const reference = { kind: "link", title: title || "Media file", url: input.href, source: "http" };
                return { tracks: [unresolved(reference, userId)] };
            }
            if (!nativeMediaExtension.test(input.pathname)) {
                throw new MusicError("This file needs FFmpeg and a configured media server. Ask the bot operator to enable file conversion.");
            }
        }
        return audioStage(parent || shutdown.signal, lookupBudget, async signal => {
            let result;
            try {
                result = await searchTracks(node, query, requester, { mediaHosts, source: soundCloudSearch ? "ytsearch" : source, signal });
                if (result.tracks.length) return result;
            } catch (error) {
                if (!extractor) throw error;
            }
            if (!extractor) return result;
            if (input instanceof URL) {
                const provider = streamProvider(input.href);
                if (!provider) return result || { tracks: [] };
                const title = provider === "youtube" ? "YouTube link" : "SoundCloud link";
                const candidate = { info: { uri: input.href, sourceName: provider } };
                return { tracks: [unresolved({ kind: "link", title, url: input.href, source: provider }, userId, candidate)] };
            }
            const providers = source === "scsearch" ? ["scsearch"] : source === "ytsearch" ? ["ytsearch"] : ["ytsearch", "scsearch"];
            const extract = provider => extractSearch(extractor, `${provider}5:${input}`, signal, extractExec).catch(error => {
                if (!signal.aborted) warn(`${provider}: ${ytDlpErrorDetail(error)}`, error);
                return [];
            });
            const prepared = soundCloudSearch ? await soundCloudSearch.entries : [];
            const results = prepared.length ? [prepared] : await Promise.all((soundCloudSearch ? ["ytsearch"] : providers).map(extract));
            const tracks = results.flat().flatMap(entry => {
                const uri = entry.webpage_url || entry.url;
                const provider = streamProvider(uri);
                if (!entry.title || !provider) return [];
                const reference = { kind: "link", title: entry.title, author: entry.uploader || entry.channel || "Unknown artist",
                    url: uri, source: provider, duration: Number(entry.duration) * 1_000 || 0 };
                const candidate = { info: { ...reference, uri, sourceName: provider,
                    soundCloudId: provider === "soundcloud" ? entry.id : undefined } };
                return [unresolved(reference, userId, candidate, !source)];
            });
            return { tracks, selection: true };
        }).catch(error => {
            if (error.name === "TimeoutError") throw new MusicError("Music search timed out. Try a direct link or `/playfile`.");
            throw error;
        });
    }

    function unresolved(reference, userId, candidate = null, allowAlternateSource = false, retryPlan) {
        allowAlternateSource ||= reference.kind === "match";
        const requester = { id: userId };
        const track = manager.utils.buildUnresolvedTrack({ info: { ...reference, uri: reference.url,
            sourceName: reference.source, isSeekable: true } }, requester);
        track.userData = { musicReference: reference, musicPlaybackId: randomUUID() };
        const phases = embedded
            ? ["native", "match", "extractMatch", "extract", "cache"]
            : ["native", "extract", "cache", "match", "extractMatch"];
        const plan = retryPlan || { phases, expires: 0, reference, userId, candidate, allowAlternateSource };
        playbackPlans.set(track, plan);

        async function findPlayable(node, signal) {
            for (let phase; (phase = plan.phases.shift());) {
                signal.throwIfAborted();
                if (phase === "native") {
                    let match = candidate?.encoded && !candidate.userData?.musicExtracted ? candidate : null;
                    if (!match && reference.kind === "match") {
                        match = await matchTrack(node, reference, requester, undefined, undefined, signal);
                    } else if (!match && !candidate) {
                        const url = checkedQuery(reference.url, mediaHosts);
                        if (media.filesEnabled && url instanceof URL && isDirectMediaUrl(url, mediaHosts)) {
                            match = await audioStage(signal, 14_000, child => media.loadFile(node, url, requester, child)).catch(error => {
                                if (!signal.aborted) warn("Decode media file", error);
                                return null;
                            });
                            if (match) {
                                Object.assign(match.info, { title: reference.title, uri: reference.url });
                                match.userData = { ...match.userData, musicExtracted: true };
                            } else if (!nativeMediaExtension.test(url.pathname)) {
                                return null;
                            }
                        }
                        if (!match) {
                            const result = await searchTracks(node, reference.url, requester, { mediaHosts, signal }).catch(() => null);
                            match = result?.tracks[0];
                        }
                    }
                    if (match) {
                        plan.candidate = match;
                        // A YouTube search result can load successfully even when the plugin cannot fetch its audio.
                        if (extractor && env.MUSIC_MEDIA_BASE_URL && !embedded && isLoopbackNode(node) &&
                            match.info.sourceName === "youtube" && !match.info.isStream) {
                            const cached = await providerTrack(node, match.info.uri, requester, match.info, signal, true);
                            if (cached) return cached;
                        }
                        return match;
                    }
                } else if (phase === "extract") {
                    const uri = plan.candidate?.info.uri || reference.url;
                    const remaining = plan.expires - Date.now();
                    if (!extractor || !streamProvider(uri) || remaining <= 0) continue;
                    const extracted = await audioStage(signal, Math.min(allowAlternateSource ? 11_000 : 17_000, remaining), child =>
                        providerTrack(node, uri, requester, plan.candidate?.info, child)).catch(() => null);
                    if (extracted) return extracted;
                } else if (phase === "cache") {
                    if (plan.direct?.info.sourceName !== "youtube" || allowAlternateSource) continue;
                    const cached = await providerTrack(node, plan.direct.info.uri, requester, plan.direct.info, signal, true);
                    if (cached) return cached;
                } else if (phase === "match") {
                    const original = plan.candidate;
                    if (!allowAlternateSource || original?.info.sourceName !== "youtube") continue;
                    const prepared = plan.preparedMatch;
                    const alternate = prepared?.node === node && !prepared.signal.aborted
                        ? await prepared.pending : await findSoundCloud(node, original, requester, signal);
                    if (alternate) {
                        plan.alternate = alternate;
                        log("DEBUG", "Music", "Trying a matched SoundCloud recording.");
                        return alternate;
                    }
                } else if (phase === "extractMatch" && plan.alternate && !plan.alternate.userData?.musicExtracted) {
                    const alternate = await providerTrack(node, plan.alternate.info.uri, requester, plan.alternate.info, signal);
                    if (alternate) return alternate;
                }
            }
            return null;
        }

        let preparation;
        function prepare(node, parent) {
            if (preparation?.node === node && media.isAvailable(preparation.track)) return preparation.pending;
            if (!plan.expires) plan.expires = Date.now() + playbackBudget;
            const entry = { node, pending:
                audioStage(parent || shutdown.signal, Math.max(1, plan.expires - Date.now()), signal => findPlayable(node, signal))
                .catch(error => {
                    if (error.name === "TimeoutError") warn("Audio resolution deadline reached", error);
                    else if (!shutdown.signal.aborted) warn("Audio resolution", error);
                    return null;
                }) };
            preparation = entry;
            void entry.pending.then(result => { entry.track = result; });
            return entry.pending;
        }
        track.resolve = async player => {
            if (startingPlayers.has(player)) startupTracks.add(track);
            const result = await prepare(player.node, player.getData?.("audioStartupSignal"));
            if (!result?.encoded) {
                if (player.queue.current === track || (player.queue.current && endedTracks.has(player.queue.current))) player.queue.current = null;
                const error = new MusicError("No playable match was found for this track.");
                error.track = track;
                throw error;
            }
            delete track.resolve;
            delete track[UnresolvedTrackSymbol];
            Object.defineProperty(track, TrackSymbol, { value: true, configurable: true });
            Object.assign(track, result, { userData: { ...result.userData, ...track.userData }, requester });
            return track;
        };
        return track;
    }

    function identifyTrack(track) {
        track.userData = { ...track.userData, musicPlaybackId: randomUUID() };
        return track;
    }

    function playbackEvent(node, packet) {
        if (shutdown.signal.aborted) return;
        const player = playerFor(packet.guildId);
        if (!player || player.node !== node) return;
        const track = player.queue.current;
        if (packet.op === "playerUpdate") {
            const start = player.getData("audioStart");
            if (!start || start.track !== track || start.confirmed || !packet.state.connected || packet.state.position <= 0) return;
            start.confirmed = true;
            startupTracks.delete(track);
            startingPlayers.get(player)?.(true);
            log("INFO", "Music", `Playback advancing (${track.info.sourceName}, ${packet.state.position} ms)`);
            void sync(player, true).catch(error => warn("playback confirmation", error));
            return;
        }
        if (packet.op !== "event" || !track) return;
        const id = track.userData?.musicPlaybackId;
        if (id && packet.track?.userData?.musicPlaybackId !== id) return;
        if (packet.type === "TrackStartEvent") {
            if (startingPlayers.has(player)) startupTracks.add(track);
            endedTracks.delete(track);
            player.deleteData("audioTransition");
            player.setData("audioStart", { track, confirmed: false });
            return;
        }
        if (packet.type === "TrackEndEvent" && packet.reason !== "replaced") {
            endedTracks.add(track);
            const start = player.getData("audioStart");
            if (packet.reason === "finished" && start?.track === track && !start.confirmed &&
                track.info.duration > 0 && track.info.duration <= 3_000) {
                startupTracks.delete(track);
                startingPlayers.get(player)?.(true);
            }
        }
        if (packet.type !== "TrackStuckEvent" && !(packet.type === "TrackEndEvent" && packet.reason === "loadFailed")) return;
        const plan = playbackPlans.get(track);
        if (plan && track.userData?.musicMediaMode === "direct") plan.direct = track;
        const canExtract = plan?.phases.includes("extract") && extractor && streamProvider(plan.candidate?.info.uri || plan.reference.url);
        const canCache = plan?.phases.includes("cache") && plan.direct?.info.sourceName === "youtube" && !plan.allowAlternateSource;
        const canMatch = plan?.phases.includes("match") && plan.allowAlternateSource && plan.candidate?.info.sourceName === "youtube";
        const canExtractAlternate = plan?.phases.includes("extractMatch") && extractor && plan.alternate && !plan.alternate.userData?.musicExtracted;
        if ((canExtract || canCache || canMatch || canExtractAlternate) && plan.expires > Date.now()) {
            const retry = unresolved(plan.reference, plan.userId, plan.candidate, plan.allowAlternateSource, plan);
            if (startupTracks.has(track) || startingPlayers.has(player)) startupTracks.add(retry);
            player.queue.tracks.unshift(retry);
            log("WARNING", "Music", `Playback failed on ${track.info.sourceName}; trying another audio path.`);
        } else if (!startingPlayers.has(player)) {
            void reportTrackError(player, track, packet).catch(error => warn("track error", error));
        }
        // The library will advance. A failed track must not be rotated back
        // into repeat-queue or retained as the current track if resolving fails.
        player.setData("audioTransition", true);
        player.queue.current = null;
        player.playing = false;
    }

    async function enqueue(interaction, ctx, tracks, { stored = false, first = false, allowAlternateSource = false } = {}) {
        if (!tracks.length) throw new MusicError("No playable tracks found.");
        const capacity = TRACK_LIMIT - (ctx.player?.queue.tracks.length || 0);
        if (capacity <= 0) throw new MusicError(`The queue is full (${TRACK_LIMIT} upcoming tracks).`);
        const queued = tracks.slice(0, capacity).map(track => {
            if (stored) return unresolved(track, ctx.userId);
            if (manager.utils.isUnresolvedTrack(track)) return track;
            if (!track.userData?.musicExtracted && streamProvider(track.info.uri) && (extractor || allowAlternateSource)) {
                return unresolved(storeTrack(track), ctx.userId, track, allowAlternateSource);
            }
            return identifyTrack(track);
        });
        const search = ctx.soundCloudSearch;
        const plan = playbackPlans.get(queued[0]);
        if (search && plan?.allowAlternateSource && plan.candidate?.info.sourceName === "youtube") {
            const node = nodeFor(ctx.guild.id);
            plan.preparedMatch = {
                node,
                signal: search.signal,
                pending: findSoundCloud(node, plan.candidate, { id: ctx.userId }, search.signal, search.entries),
            };
        }
        const player = await join(interaction, ctx);
        if (player.getData("idle")) clearTimeout(player.getData("idle"));
        await player.queue.add(queued, first ? 0 : undefined);
        if (!player.playing && !player.queue.current && !player.getData("audioTransition")) {
            try {
                await audioStage(ctx.audioSignal || shutdown.signal, playbackBudget, async signal => {
                    let finish;
                    const confirmed = new Promise(resolve => { finish = resolve; });
                    startingPlayers.set(player, finish);
                    player.setData("audioStartupSignal", signal);
                    try {
                        await player.play({ paused: false }).catch(error => {
                            if (!player.queue.current && !player.queue.tracks.length) throw new MusicError("No playable match was found for this track.");
                            throw error;
                        });
                        signal.throwIfAborted();
                        if (!player.queue.current && !player.getData("audioTransition") && !player.playing) finish(false);
                        if (!await confirmed) {
                            throw new MusicError("The player could not start audio for those tracks.");
                        }
                    } finally {
                        finish(false);
                        startingPlayers.delete(player);
                        player.deleteData("audioStartupSignal");
                    }
                });
            } catch (error) {
                startingPlayers.get(player)?.(false);
                if (error.name === "TimeoutError") {
                    player.deleteData("audioStartupSignal");
                    if (player.queue.current && player.queue.tracks.length) {
                        await player.skip(1, false).catch(inner => warn("skip timed-out track", inner));
                    } else if (playerFor(player.guildId) === player) {
                        await player.destroy("Playback did not advance before the deadline").catch(inner => warn("voice cleanup", inner));
                    }
                    throw new MusicError("Playback did not start in time. Try another source or an audio file.");
                }
                if (!player.playing) scheduleIdle(player, ctx.settings);
                throw error;
            }

        } else {
            void refresh(player).catch(error => warn("queue panel", error));
        }
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

    async function reportTrackError(player, track, failure, notify = true) {
        const details = failure?.type === "TrackStuckEvent"
            ? `No audio frames for ${failure.thresholdMs} ms.`
            : failure?.exception?.message || failure?.message;
        log("WARNING", "Music", `Playback failed (${track?.info?.sourceName || "unknown source"}).`, details, failure?.exception?.cause);
        if (!notify || startupTracks.has(track)) return;
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
        const { paused, lastPosition, volume, repeatMode } = old;
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
        if (current) {
            const reference = current.userData?.musicReference;
            const track = current.userData?.musicExtracted && reference ? unresolved(reference, current.requester.id) : current;
            const position = current.info.isSeekable ? Math.max(0, Math.min(lastPosition, current.info.duration - 1)) : 0;
            await player.play({ clientTrack: track, position, paused });
        }
        else if (tracks.length) await player.play({ paused: false });
    }

    async function restorePlayer(player) {
        const guild = client.guilds.cache.get(player.guildId);
        const voice = guild?.channels.cache.get(player.voiceChannelId);
        if (!voice || playerFor(guild.id) !== player || shutdown.signal.aborted) return;
        const settings = await data.settings(guild.id);
        await repair({ guild, channelId: player.textChannelId }, { guild, voice, settings, player });
        log("INFO", "Music", "Restored the queue after a fresh Lavalink session.");
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
        function reportReady(node) {
            const session = sessions.get(node);
            if (!session || !node.connected || !node.sessionId || !node.info || readyNodes.has(node) || shutdown.signal.aborted) return;
            readyNodes.add(node);
            connectionErrors.delete(node.id);
            void node.updateSession(true, 60).catch(error => warn("enable Lavalink session resumption", error));
            if (onNodeReady) onNodeReady(node.id);
            else log("SUCCESS", "Audio Node", `${node.id} connected`);
            if (embedded && node.id === "primary") {
                const youtube = node.info.plugins?.find(plugin => plugin.name === "youtube-plugin");
                if (youtube && node.info.sourceManagers?.includes("youtube")) {
                    log("INFO", "Audio Node", `Lavalink ${node.info.version?.semver}; youtube-plugin ${youtube.version}`);
                } else log("WARNING", "Audio Node", "The embedded node did not register youtube-plugin and its YouTube source.");
            }
            if (session.previous && !session.resumed) {
                for (const player of manager.players.values()) {
                    if (player.node === node) void serial(controls, player.guildId, () => restorePlayer(player))
                        .catch(error => warn("restore player after reconnect", error));
                }
            }
        }

        manager.nodeManager.on("error", (node, error) => {
            const status = /^Unexpected server response: (\d{3})$/.exec(error?.message)?.[1];
            const detail = status ? `HTTP ${status}` : error?.code || error?.name || "unknown error";
            const last = connectionErrors.get(node.id);
            const now = Date.now();
            if (last?.detail === detail && now - last.time < 30_000) return;
            connectionErrors.set(node.id, { detail, time: now });
            const action = status === "401" || status === "403" ? " Check the Lavalink password." : "";
            log("WARNING", "Audio Node", `${node.id} connection failed (${detail}).${action}`);
        });
        manager.nodeManager.on("connect", reportReady);
        manager.nodeManager.on("raw", (node, packet) => {
            playbackEvent(node, packet);
            // The library emits raw before setting the session ID from the ready packet.
            if (packet.op === "ready") {
                sessions.set(node, { previous: node.options.sessionId, resumed: packet.resumed });
                node.options.sessionId = packet.sessionId;
                queueMicrotask(() => reportReady(node));
            }
        });
        manager.nodeManager.on("resumed", (node, _, players) => {
            for (const state of players) {
                const player = playerFor(state.guildId);
                if (player?.node !== node) continue;
                player.paused = state.paused;
                player.playing = Boolean(state.track) && !state.paused;
                player.connected = state.state.connected;
                player.lastPosition = state.state.position;
                player.lastPositionChange = Date.now();
            }
        });
        manager.nodeManager.on("disconnect", (node, { code, reason }) => {
            sessions.delete(node);
            if (readyNodes.delete(node) && !shutdown.signal.aborted && !["Node-Destroy", "Node-Disconnect"].includes(reason)) {
                log("WARNING", "Audio Node", `${node.id} disconnected (${code})`);
            }
        });
        manager.on("trackStart", (player, track) => {
            const title = sanitizeSingleLine(track?.info?.title, 100);
            if (title) log("INFO", "Music", `TrackStart: ${title}`);
            player.deleteData("votes");
            player.deleteData("sponsorSegments");
            if (!player.getData("audioStart")) void sync(player, true).catch(error => warn("track start", error));
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
        manager.on("queueEnd", player => {
            player.deleteData("audioTransition");
            player.deleteData("audioStart");
            startingPlayers.get(player)?.(false);
            void sync(player, false).catch(error => warn("queue end", error));
        });
        manager.on("trackError", (player, track, cause) => {
            const notify = cause?.type !== "TrackExceptionEvent" && !startingPlayers.has(player);
            void reportTrackError(player, cause?.track || track, cause, notify).catch(error => warn("track error", error));
        });
        manager.on("playerMove", player => { void sync(player, false).catch(error => warn("voice move", error)); });
        manager.on("playerDestroy", player => {
            startingPlayers.get(player)?.(false);
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
        manager, data, guard, nodeFor, audioStatus, playerFor, join, enqueue, lookup, unresolved, refresh, sync, scheduleIdle,
        startSoundCloudSearch,
        playbackDeadline: action => action(AbortSignal.any([shutdown.signal, AbortSignal.timeout(playbackBudget)])),
        select, selected, consumeSelection: id => selections.delete(id), applyFilter, applySponsors, repair, storeTrack,
        serialize: (id, fn) => serial(controls, id, fn),
        voiceChannel: player => client.channels.cache.get(player.voiceChannelId),
        handleMedia: media.handleHttp,
        start,
        close: async () => {
            startup?.abort();
            shutdown.abort();
            if (!manager) return;
            await Promise.allSettled([...manager.players.values()].map(player => player.destroy("Bot shutdown")));
            await Promise.allSettled([...manager.nodeManager.nodes.values()].map(async node => {
                const socket = node.socket;
                node.destroy("Bot shutdown", true);
                if (socket?.readyState === 2) await once(socket, "close", { signal: AbortSignal.timeout(1_000) }).catch(() => {});
            }));
        },
    };
}

module.exports = { createMusic, nodeOptions };
