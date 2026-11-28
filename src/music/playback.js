const { AttachmentBuilder } = require("discord.js");
const { listPanel, playerPanel, searchPanel } = require("./panel");
const { MusicError, noMentions, musicText, trackTitle, trackLink, duration } = require("./shared");
const filters = require("./filters");

const loopModes = ["off", "track", "queue"];
const trackControls = new Set(["pause", "resume", "toggle", "replay", "seek", "forward", "rewind", "skip", "skipto", "voteskip"]);

function timestamp(value) {
    if (!/^(?:\d{1,2}:)?(?:\d{1,2}:)?\d{1,7}$/.test(value)) throw new MusicError("Use seconds, `m:ss`, or `h:mm:ss`.");
    const parts = value.split(":").map(Number);
    if (parts.slice(1).some(part => part >= 60)) throw new MusicError("Use seconds, `m:ss`, or `h:mm:ss`.");
    return parts.reduce((time, part) => time * 60 + part, 0) * 1000;
}

function positionIn(items, value) {
    if (!Number.isInteger(value) || value < 1 || value > items.length) throw new MusicError(`Use a position from the current list (${items.length} tracks).`);
    return value - 1;
}

function identity(track) {
    return track.info.uri || track.userData?.musicReference?.url || `${track.info.sourceName}:${track.info.identifier}`;
}

function requireTrack(player) {
    if (!player.queue.current) throw new MusicError("There’s no track playing.");
    return player.queue.current;
}

async function lyrics(track) {
    if (track.info.isStream) throw new MusicError("Lyrics are unavailable for live streams.");
    const url = new URL("https://lrclib.net/api/get");
    url.search = new URLSearchParams({ track_name: track.info.title, artist_name: track.info.author,
        duration: String(Math.round(track.info.duration / 1000)) });
    if (track.pluginInfo?.albumName) url.searchParams.set("album_name", track.pluginInfo.albumName);
    try {
        let response = await fetch(url, { signal: AbortSignal.timeout(6000) });
        let result = response.ok ? await response.json() : null;
        if (response.status === 404 || (response.ok && !result?.plainLyrics)) {
            url.pathname = "/api/search";
            url.searchParams.delete("duration");
            url.searchParams.delete("album_name");
            response = await fetch(url, { signal: AbortSignal.timeout(6000) });
            if (response.ok) {
                const matches = await response.json();
                result = matches.find(item => item.plainLyrics && item.trackName?.toLowerCase() === track.info.title.toLowerCase() &&
                    item.artistName?.toLowerCase() === track.info.author.toLowerCase() &&
                    Math.abs(item.duration - track.info.duration / 1000) < 8);
            }
        }
        if (response.ok || response.status === 404) {
            if (!result?.plainLyrics) throw new MusicError("LRCLIB doesn’t have lyrics for this track.");
            const text = result.plainLyrics;
            if (text.length <= 1750) return `**${trackTitle(track)}** · Lyrics from LRCLIB\n\n${text}`;
            return { content: `**${trackTitle(track)}** · Lyrics from LRCLIB`,
                files: [new AttachmentBuilder(Buffer.from(text), { name: "lyrics.txt" })] };
        }
    } catch (error) {
        if (error instanceof MusicError) throw error;
    }
    throw new MusicError("The lyrics provider is unavailable. Try again later.");
}

function queued(result, name) {
    return `Queued **${result.amount} ${result.amount === 1 ? "track" : "tracks"}**${name ? ` from **${musicText(name)}**` : ""}.${result.omitted ? ` ${result.omitted} didn’t fit in the queue.` : ""}`;
}

async function playInput(music, interaction, command, options) {
    return music.playbackDeadline(signal => resolvePlayInput(music, interaction, command, options, signal)).catch(error => {
        if (error.name === "TimeoutError") throw new MusicError("Playback did not start in time. Try another source or an audio file.");
        throw error;
    });
}

async function resolvePlayInput(music, interaction, command, options, signal) {
    const ctx = await music.guard(interaction, command, { voice: true });
    signal.throwIfAborted();
    ctx.audioSignal = signal;
    const query = command === "playfile" ? options.file?.url : options.query;
    if (!query) throw new MusicError("Enter a song name or link, or attach an audio file.");
    const source = command === "search" ? options.source : undefined;
    const result = await music.lookup(ctx.guild.id, query, ctx.userId, source, signal);
    signal.throwIfAborted();
    if (!result.tracks.length) throw new MusicError("No playable audio found. Try a different link or search.");
    if (command === "search" && result.selection) {
        const matches = result.tracks.slice(0, 10);
        return searchPanel(matches, music.select(interaction, matches));
    }
    const tracks = result.selection ? result.tracks.slice(0, 1) : result.tracks;
    const added = await music.enqueue(interaction, ctx, tracks, { stored: result.matched, first: options.first,
        allowAlternateSource: command === "play" && result.selection });
    return tracks.length === 1 ? `Queued **${result.matched ? musicText(tracks[0].title) : trackTitle(tracks[0])}**.` : queued(added, result.name);
}

async function playSelection(music, interaction, id) {
    const ctx = await music.guard(interaction, "play", { voice: true });
    await music.guard(interaction, "search");
    const track = music.selected(interaction, id);
    await music.enqueue(interaction, ctx, [track]);
    music.consumeSelection(id);
}

async function spotifySearch(music, interaction, command, query) {
    const ctx = await music.guard(interaction, command, { voice: true });
    const node = music.nodeFor(ctx.guild.id);
    if (!node.info?.sourceManagers?.includes("spotify") || !node.info.plugins?.some(plugin => plugin.name === "lavasearch-plugin")) {
        throw new MusicError("Spotify catalog search needs Spotify access and LavaSearch on Lavalink. You can paste a public Spotify link in `/play`.");
    }
    const type = command.slice("search".length);
    const result = await node.lavaSearch({ query, source: "spsearch", types: [type] }, { id: ctx.userId })
        .catch(() => { throw new MusicError("Spotify catalog search is unavailable. Try a public Spotify link in `/play`."); });
    const list = result?.[`${type}s`]?.find(match => match.tracks?.length);
    if (!list) throw new MusicError(`Spotify returned no matching ${type}.`);
    return queued(await music.enqueue(interaction, ctx, list.tracks), list.info?.name || query);
}

async function controls(music, interaction, action, options = {}) {
    const readOnly = ["nowplaying", "queue", "history", "lyrics", "grab", "like", "dislike"].includes(action);
    const command = { quieter: "volume", louder: "volume", toggle: options.paused ? "resume" : "pause" }[action] || action;
    const managesRepair = ["forcefix", "switchaudionode"].includes(action);
    const ctx = await music.guard(interaction, command, { player: action !== "connect", voice: !readOnly || Boolean(options.panelId), manage: managesRepair });
    const player = ctx.player;
    if (options.panelId && options.panelId !== player.getData("panelId")) throw new MusicError("This player card expired. Use `/nowplaying`.");
    const track = trackControls.has(action) ? requireTrack(player) : player?.queue.current;
    const queue = player?.queue;
    switch (action) {
        case "connect":
            await music.join(interaction, ctx);
            return `Connected to ${ctx.voice}.`;
        case "disconnect":
            await player.destroy("Music disconnect command");
            return "Disconnected from voice.";
        case "nowplaying":
            return playerPanel(player, player.getData("panelId"), ctx.settings.buttons);
        case "queue":
            return listPanel(track ? `Up next · ${musicText(track.info.title, 80)}` : "Up next", queue.tracks, options.page);
        case "history":
            return listPanel("Recently played", queue.previous, options.page);
        case "lyrics":
            return lyrics(requireTrack(player));
        case "grab": {
            const current = requireTrack(player);
            const href = trackLink(current);
            await interaction.user.send({ content: `**${trackTitle(current)}** · ${musicText(current.info.author)}${href ? `\n<${href}>` : ""}`,
                allowedMentions: noMentions }).catch(() => { throw new MusicError("I couldn’t send you a DM. Check your Discord privacy settings."); });
            return "Sent the track to your DMs.";
        }
        case "like":
        case "dislike": {
            const chosen = action === "dislike" && (options.previous || !track) ? queue.previous[0] : track;
            if (!chosen) throw new MusicError("There’s no track to save or remove.");
            const item = music.storeTrack(chosen);
            if (!item) throw new MusicError("This track can’t be saved. Discord attachment links may expire.");
            await music.data.editLiked(ctx.userId, items => {
                if (action === "dislike") return items.filter(saved => saved.url !== item.url);
                if (items.some(saved => saved.url === item.url)) return items;
                if (items.length >= 500) throw new MusicError("You can save up to 500 liked tracks.");
                return [...items, item];
            });
            return action === "like" ? "Saved to your liked songs." : "Removed from your liked songs.";
        }
        case "pause":
        case "resume":
        case "toggle": {
            const pause = action === "toggle" ? !player.paused : action === "pause";
            if (pause !== player.paused) await (pause ? player.pause() : player.resume());
            return pause ? "Playback paused." : "Playback resumed.";
        }
        case "skip":
        case "skipto":
        case "voteskip": {
            const target = options.position || 1;
            if (options.position) positionIn(queue.tracks, target);
            if (action === "voteskip") {
                const voice = ctx.guild.channels.cache.get(player.voiceChannelId);
                const listeners = voice.members.filter(member => !member.user.bot);
                const required = Math.max(1, Math.floor(listeners.size / 2) + 1);
                const votes = player.getData("votes") || new Map();
                const voters = votes.get(target) || new Set();
                for (const voter of voters) if (!listeners.has(voter)) voters.delete(voter);
                for (const other of votes.values()) other.delete(ctx.userId);
                voters.add(ctx.userId);
                votes.set(target, voters);
                player.setData("votes", votes);
                if (voters.size < required) return { content: `Skip votes for queue position ${target} · ${voters.size}/${required}.` };
            }
            if (target > 1) {
                const next = queue.tracks[target - 1];
                await queue.splice(target - 1, 1);
                await queue.add(next, 0);
            }
            await player.skip(1, false);
            player.deleteData("votes");
            return target > 1 ? `Skipped to queue position ${target}.` : "Skipped the current track.";
        }
        case "previous": {
            const previous = queue.previous.shift();
            if (!previous) throw new MusicError("There’s no previous track.");
            if (track) await queue.add(track, 0);
            await player.play({ clientTrack: previous, paused: false });
            return `Playing **${trackTitle(previous)}**.`;
        }
        case "stop":
            if (track) await player.stopPlaying(true, false);
            else await queue.splice(0, queue.tracks.length);
            player.deleteData("votes");
            return "Playback stopped and the queue was cleared.";
        case "seek":
        case "replay":
        case "forward":
        case "rewind": {
            if (!track.info.isSeekable || track.info.isStream) throw new MusicError("This track can’t be seeked.");
            const offset = (options.seconds || 15) * (action === "rewind" ? -1000 : 1000);
            const at = action === "seek" ? timestamp(options.time || "") : action === "replay" ? 0 : player.position + offset;
            const next = Math.max(0, Math.min(at, Math.max(track.info.duration - 1, 0)));
            await player.seek(next);
            return `Position set to **${duration(next)}**.`;
        }
        case "volume":
        case "quieter":
        case "louder": {
            if (action === "volume" && options.level == null) return `Volume is **${player.volume}%**.`;
            const next = options.level ?? Math.max(0, Math.min(150, player.volume + (action === "louder" ? 10 : -10)));
            await player.setVolume(next);
            return `Volume set to **${next}%**.`;
        }
        case "loop": {
            const mode = options.mode || loopModes[(loopModes.indexOf(player.repeatMode) + 1) % loopModes.length];
            await player.setRepeatMode(mode);
            return `Loop is **${mode}**.`;
        }
        case "autoplay": {
            const enabled = options.enabled ?? !player.getData("autoplay");
            player.setData("autoplay", enabled);
            return `Autoplay is **${enabled ? "on" : "off"}**.`;
        }
        case "shuffle":
            if (queue.tracks.length < 2) throw new MusicError("Queue at least two upcoming tracks to shuffle.");
            await queue.shuffle();
            player.deleteData("votes");
            return "Shuffled the queue.";
        case "clear":
            await queue.splice(0, queue.tracks.length);
            player.deleteData("votes");
            return "Cleared the upcoming queue.";
        case "remove":
        case "bump":
        case "move": {
            if (options.sub === "bot") {
                if (!options.channel || options.channel.id === player.voiceChannelId) throw new MusicError("Choose a different voice channel.");
                if (!ctx.manager && ctx.guild.voiceStates.cache.get(ctx.userId)?.channelId !== options.channel.id &&
                    !interaction.memberPermissions?.has("MoveMembers")) throw new MusicError("You need Move Members to move the player to another channel.");
                await music.join(interaction, ctx, options.channel, true);
                await music.sync(player, false);
                return `Moved the player to ${options.channel}.`;
            }
            if (options.sub === "duplicates") {
                const seen = new Set(track ? [identity(track)] : []);
                const before = queue.tracks.length;
                queue.tracks = queue.tracks.filter(item => {
                    const key = identity(item);
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
                await queue.utils.save();
                player.deleteData("votes");
                return `Removed ${before - queue.tracks.length} duplicate tracks.`;
            }
            const from = positionIn(queue.tracks, options.position);
            const to = action === "move" ? positionIn(queue.tracks, options.to) : 0;
            const item = queue.tracks[from];
            await queue.splice(from, 1);
            if (action !== "remove") await queue.add(item, to);
            player.deleteData("votes");
            return action === "remove" ? `Removed **${trackTitle(item)}**.` : `Moved **${trackTitle(item)}** to #${to + 1}.`;
        }
        case "leavecleanup": {
            const members = ctx.guild.channels.cache.get(player.voiceChannelId).members;
            const count = queue.tracks.length;
            queue.tracks = queue.tracks.filter(item => !item.requester?.id || members.has(item.requester.id));
            await queue.utils.save();
            player.deleteData("votes");
            return `Removed ${count - queue.tracks.length} tracks requested by people who left voice.`;
        }
        case "forcefix":
            await music.repair(interaction, ctx);
            return "Reconnected the player and restored its queue.";
        case "switchaudionode": {
            const node = music.manager.nodeManager.leastUsedNodes().find(item => item !== player.node && item.sessionId);
            if (!node) throw new MusicError("Configure a second Lavalink server to switch audio nodes.");
            await player.changeNode(node);
            if (player.getData("effect")) {
                const effect = player.getData("effect");
                player.deleteData("effect");
                await music.applyFilter(player, effect);
            }
            if (ctx.settings.sponsors) await music.applySponsors(player, true);
            return `Switched to the ${node.id} audio server.`;
        }
        default:
            if (Object.hasOwn(filters, action) || action === "resetfilter") {
                const effect = await music.applyFilter(player, action);
                return effect ? `Enabled the **${effect}** filter.` : "Audio filters cleared.";
            }
            throw new MusicError("That music control is unavailable.");
    }
}

module.exports = { controls, playInput, playSelection, spotifySearch, queued, requireTrack, positionIn, timestamp };
