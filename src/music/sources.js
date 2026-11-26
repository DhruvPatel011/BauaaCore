const { isIP } = require("node:net");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { MusicError, TRACK_LIMIT } = require("./shared");

const publicSources = [
    "youtube.com", "youtu.be", "soundcloud.com", "spotify.com", "spotify.link", "spoti.fi",
    "music.apple.com", "itunes.apple.com", "deezer.com", "deezer.page.link", "tidal.com", "qobuz.com",
    "jiosaavn.com", "kuwo.cn", "bandcamp.com", "twitch.tv", "vimeo.com", "bandcampcdn.com",
    "cdn.discordapp.com", "media.discordapp.net", "archive.org", "upload.wikimedia.org", "samplelib.com",
];
const directSources = ["cdn.discordapp.com", "media.discordapp.net", "archive.org", "upload.wikimedia.org", "samplelib.com"];
const mediaExtension = /\.(?:mp3|m4a|aac|ogg|opus|oga|flac|wav|mp4|webm|aiff|wma)$/i;
const spotifyPath = /^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|artist)\/([A-Za-z0-9]{22})\/?$/;
const searchSources = ["ytsearch", "scsearch"];
const execute = promisify(execFile);

function customHosts(env = process.env) {
    return (env.MUSIC_MEDIA_HOSTS || "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean);
}

function isSource(host, domains) {
    return domains.some(domain => host === domain || host.endsWith(`.${domain}`));
}

function checkedQuery(input, trusted = []) {
    const query = input.trim();
    if (!query || query.length > 2000) throw new MusicError("Enter a song name or a valid audio link.");
    if (/^spotify:(track|album|playlist|artist):[A-Za-z0-9]{22}$/.test(query)) {
        const [, type, id] = query.split(":");
        return new URL(`https://open.spotify.com/${type}/${id}`);
    }
    if (!/^[a-z][a-z\d+.-]*:\/\/|^www\.|^\/\//i.test(query)) return query;
    let url;
    try {
        url = new URL(query.startsWith("www.") ? `https://${query}` : query);
    } catch {
        throw new MusicError("Enter a valid HTTP or HTTPS music link.");
    }
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port ||
        isIP(url.hostname.replace(/^\[|\]$/g, "")) || !url.hostname.includes(".") ||
        (!isSource(url.hostname, publicSources) && !trusted.includes(url.hostname))) {
        throw new MusicError("Use a supported streaming link or upload the audio with `/playfile`. An operator can enable more media hosts.");
    }
    if ((directSources.includes(url.hostname) || trusted.includes(url.hostname)) && !mediaExtension.test(url.pathname)) {
        throw new MusicError("Use a direct media file link or upload the file with `/playfile`.");
    }
    return url;
}

function spotifyItem(url) {
    if (url.hostname !== "open.spotify.com") return null;
    const parts = spotifyPath.exec(url.pathname);
    return parts ? { type: parts[1], id: parts[2] } : null;
}

function embedTrack(item, defaults = {}) {
    const uri = item.uri || item.uid || defaults.uri;
    const match = /^spotify:track:([A-Za-z0-9]{22})$/.exec(uri || "");
    const title = item.title || item.name;
    const author = item.subtitle || item.artists?.map?.(artist => artist.name).filter(Boolean).join(", ") || defaults.author;
    if (!match || typeof title !== "string" || typeof author !== "string" || !title || !author) return null;
    return {
        kind: "match",
        title: title.slice(0, 300),
        author: author.slice(0, 300),
        duration: Number(item.duration ?? item.durationMs ?? item.duration_ms) || 0,
        url: `https://open.spotify.com/track/${match[1]}`,
        source: "spotify",
    };
}

function parseSpotifyEmbed(html, type, id) {
    const script = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
    if (!script) return null;
    const props = JSON.parse(script[1])?.props?.pageProps;
    const entity = props?.state?.data?.entity || props?.data?.entity || props?.entity;
    if (!entity) return null;
    const list = entity.trackList || entity.tracks || entity.topTracks || [];
    const entries = Array.isArray(list) ? list : (list.items || []);
    let tracks = entries.map(item => embedTrack(item.track || item, { author: entity.subtitle })).filter(Boolean);
    if (type === "track") {
        const track = embedTrack(entity, { uri: `spotify:track:${id}`, author: entity.artists?.map?.(artist => artist.name).join(", ") });
        if (track) tracks = [track];
    }
    return { name: entity.name || entity.title || `Spotify ${type}`, tracks: tracks.slice(0, TRACK_LIMIT) };
}

async function spotifyEmbed(item) {
    const response = await fetch(`https://open.spotify.com/embed/${item.type}/${item.id}`, {
        signal: AbortSignal.timeout(8000),
        redirect: "error",
        headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" },
    });
    if (!response.ok) return null;
    return parseSpotifyEmbed(await response.text(), item.type, item.id);
}

function normalized(value) {
    return String(value || "").normalize("NFKD").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function similarTrack(track, reference) {
    const title = normalized(reference.title);
    const author = normalized(reference.author.split(",")[0]);
    const resultTitle = normalized(track.info.title);
    const resultAuthor = normalized(track.info.author);
    const titleMatch = resultTitle === title ? 6 : resultTitle.includes(title) ? 3 : 0;
    const authorMatch = author && (resultAuthor.includes(author) || resultTitle.includes(author)) ? 3 : 0;
    if (!titleMatch || !authorMatch) return 0;
    const gap = Number(reference.duration) && Math.abs(track.info.duration - reference.duration);
    return titleMatch + authorMatch + (gap > 25000 ? -5 : gap > 5000 ? -2 : 1) - (track.info.isStream ? 6 : 0);
}

async function matchTrack(node, reference, requester, resolve = track => track) {
    for (const source of searchSources) {
        const results = await node.search({ query: `${reference.title} ${reference.author}`, source }, requester).catch(() => null);
        const ranked = (results?.tracks || []).map(track => ({ track, score: similarTrack(track, reference) }))
            .sort((left, right) => right.score - left.score);
        for (const { track, score } of ranked.slice(0, 3)) {
            if (score < 6) break;
            const playable = await resolve(track);
            if (playable) return playable;
        }
    }
    return null;
}

function streamProvider(input) {
    try {
        const url = new URL(input);
        if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
        if (isSource(url.hostname, ["youtube.com", "youtu.be"])) return "youtube";
        if (isSource(url.hostname, ["soundcloud.com"])) return "soundcloud";
    } catch {
        return null;
    }
    return null;
}

async function directProviderTrack(node, input, requester, binary, exec = execute, fallback) {
    const provider = binary && streamProvider(input);
    if (!provider) return null;
    const { stdout } = await exec(binary, ["--ignore-config", "--no-warnings", "--js-runtimes", "node", "--no-playlist",
        "-q", "-f", "bestaudio[protocol=https]/best[protocol=https]", "--print",
        '{"url":%(url)j,"title":%(title)j,"id":%(id)j,"duration":%(duration)j,"author":%(uploader)j,"artwork":%(thumbnail)j}',
        "--", input], { timeout: 20000, maxBuffer: 65536, windowsHide: true });
    const metadata = JSON.parse(stdout.trim());
    const resource = new URL(metadata.url);
    const mediaDomains = provider === "youtube" ? ["googlevideo.com"] : ["sndcdn.com"];
    if (resource.protocol !== "https:" || resource.username || resource.password || resource.port ||
        !isSource(resource.hostname, mediaDomains)) return null;
    // The URL YouTube issues to the bot may be bound to its IP. If the bot can
    // serve the audio, let Lavalink load it from the bot before trying that URL.
    let track = provider === "youtube" ? await fallback?.(node, input, requester, binary) : null;
    if (!track) {
        const result = await node.search({ query: resource.href }, requester).catch(() => null);
        track = result?.tracks?.[0];
    }
    if (!track && provider === "soundcloud") track = await fallback?.(node, input, requester, binary);
    if (!track?.encoded || track.info.sourceName !== "http") return null;
    const duration = Number(metadata.duration) * 1000;
    Object.assign(track.info, { uri: input, sourceName: provider, identifier: String(metadata.id || track.info.identifier),
        title: metadata.title || track.info.title, author: metadata.author || track.info.author,
        artworkUrl: metadata.artwork || track.info.artworkUrl, duration: Number.isFinite(duration) && duration > 0 ? duration : track.info.duration });
    track.userData = { ...track.userData, musicExtracted: true };
    return track;
}

function storeTrack(track) {
    if (track.userData?.musicReference) return track.userData.musicReference;
    const { title, author, uri, duration, sourceName } = track.info;
    if (sourceName === "http" && uri) {
        const parsed = new URL(uri);
        if (["cdn.discordapp.com", "media.discordapp.net"].includes(parsed.hostname) && parsed.searchParams.has("ex")) return null;
    }
    if (!uri || sourceName === "flowery-tts") return null;
    return { kind: "link", title, author, url: uri, duration, source: sourceName };
}

async function searchTracks(node, input, requester, options = {}) {
    const query = checkedQuery(input, options.mediaHosts);
    if (typeof query === "string") {
        const sources = options.source ? [options.source] : searchSources;
        let failed;
        for (const source of sources) {
            const result = await node.search({ query, source }, requester).catch(error => { failed = error; });
            if (result?.tracks?.length) return { tracks: result.tracks, selection: true };
        }
        if (failed) throw new MusicError("The music search provider is unavailable. Try a link or `/playfile`.");
        return { tracks: [] };
    }
    let url = query;
    if (["spotify.link", "spoti.fi"].includes(url.hostname)) {
        const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) }).catch(() => null);
        await response?.body?.cancel();
        const destination = response?.headers.get("location");
        if (!destination) throw new MusicError("Open the Spotify share link and paste its `open.spotify.com` URL.");
        url = new URL(destination, url);
        if (!spotifyItem(url)) throw new MusicError("Paste the original `open.spotify.com` track or playlist URL.");
    }
    const spotify = spotifyItem(url);
    if (spotify) {
        const publicResult = await spotifyEmbed(spotify).catch(() => null);
        if (publicResult?.tracks.length) return { ...publicResult, matched: true, playlist: spotify.type !== "track" };
        if (!node.info?.sourceManagers?.includes("spotify")) {
            throw new MusicError("Spotify didn’t expose the tracks for this link. Try a public Spotify link, a YouTube playlist, or `/spotify playlists` if your account is linked.");
        }
    }
    const result = await node.search({ query: url.href }, requester)
        .catch(() => { throw new MusicError("The audio source could not load that link. Try another link or `/playfile`."); });
    if (result.loadType === "error") throw new MusicError("The source rejected this link. Try another link or `/playfile`.");
    return { tracks: (result.tracks || []).slice(0, TRACK_LIMIT), name: result.playlist?.title, playlist: result.loadType === "playlist" };
}

module.exports = { checkedQuery, customHosts, parseSpotifyEmbed, spotifyItem, matchTrack, storeTrack, searchTracks, streamProvider, directProviderTrack };
