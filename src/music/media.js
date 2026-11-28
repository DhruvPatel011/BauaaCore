const { execFile } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { createWriteStream } = require("node:fs");
const { mkdtemp, rm, rmdir } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { promisify } = require("node:util");
const { ytDlpOptions } = require("./shared");
const { loadTracks } = require("./audioDeadline");

const execute = promisify(execFile);
const maxTrackBytes = 16 * 1024 * 1024;
const maxCacheBytes = 32 * 1024 * 1024;
const maxFileBytes = 64 * 1024 * 1024;
const format = "bestaudio[protocol=https][ext=webm]/bestaudio[protocol=https][ext=m4a]";
const mediaPrefix = "/music/audio/";
// Self-contained containers only. Playlist demuxers can open secondary inputs.
const fileDemuxers = ["aac", "ac3", "aiff", "amr", "amrnb", "amrwb", "ape", "asf", "au", "avi", "caf", "dts", "dtshd",
    "eac3", "flac", "flv", "gsm", "matroska", "webm", "mov", "mp4", "m4a", "3gp", "3g2", "mj2", "mp3", "mpeg", "mpegts",
    "mpegtsraw", "mxf", "ogg", "rm", "tta", "voc", "w64", "wav", "wv"].join(",");
const opusOutput = ["-map", "0:a:0", "-vn", "-sn", "-dn", "-c:a", "libopus", "-application", "audio", "-compression_level", "0",
    "-threads", "1", "-b:a", "96k", "-f", "ogg", "pipe:1"];

function createMediaCache(address, exec = execute) {
    const audio = new Map();
    const cachedTracks = new WeakMap();
    let origin;
    let bytes = 0;
    let busy = false;
    if (address) {
        try {
            const url = new URL(address);
            if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) origin = url.origin;
        } catch {
            console.warn("[Music] MUSIC_MEDIA_BASE_URL needs to be an HTTP or HTTPS origin.");
        }
    }

    async function renderAudio(command, args, signal) {
        const { stdout } = await exec(command, args, {
            timeout: 12_000, encoding: "buffer", maxBuffer: maxTrackBytes, windowsHide: true, signal,
        });
        return stdout;
    }

    async function cacheAudio(node, requester, makeAudio, fixedExtension, signal) {
        if (!origin || busy || signal?.aborted) return null;
        busy = true;
        try {
            const stdout = await makeAudio();
            if (signal?.aborted || !Buffer.isBuffer(stdout) || stdout.length < 1024 || stdout.length > maxTrackBytes) return null;
            for (const [id, entry] of audio) if (entry.expires <= Date.now()) remove(id);
            while (bytes + stdout.length > maxCacheBytes && audio.size) remove(audio.keys().next().value);
            const id = randomBytes(18).toString("base64url");
            const extension = fixedExtension || (stdout.readUInt32BE(0) === 0x1a45dfa3 ? "webm" : "m4a");
            const type = { webm: "audio/webm", m4a: "audio/mp4", opus: "audio/ogg" }[extension];
            audio.set(id, { body: stdout, extension, type, expires: Date.now() + 7200000 });
            bytes += stdout.length;
            const result = await loadTracks(node, { query: `${origin}${mediaPrefix}${id}.${extension}` }, requester, signal).catch(() => null);
            const track = signal?.aborted ? null : result?.tracks?.[0];
            if (track) cachedTracks.set(track, id);
            else remove(id);
            return track || null;
        } finally {
            busy = false;
        }
    }

    function load(node, input, requester, binary, signal) {
        const args = [...ytDlpOptions, "--max-filesize", "16M", "-q", "-f", format, "-o", "-", "--", input];
        return cacheAudio(node, requester, () => renderAudio(binary, args, signal), undefined, signal);
    }

    function loadHls(node, input, requester, signal) {
        // Decode AAC here because the native SoundCloud source and Lavalink's
        // AAC decoder do not handle every HLS rendition. Fast Opus encoding
        // fits the hosted CPU budget better than a complete MP3 transcode.
        const args = ["-nostdin", "-loglevel", "error", "-xerror", "-rw_timeout", "4000000",
            "-reconnect", "1", "-reconnect_on_network_error", "1", "-reconnect_delay_max", "1",
            "-protocol_whitelist", "https,tls,tcp,crypto", "-i", input, ...opusOutput];
        return cacheAudio(node, requester, () => renderAudio("ffmpeg", args, signal), "opus", signal);
    }

    function loadFile(node, url, requester, signal) {
        return cacheAudio(node, requester, async () => {
            const directory = await mkdtemp(join(tmpdir(), "bauaa-media-"));
            const input = join(directory, "media");
            try {
                const response = await fetch(url, { redirect: "error", signal });
                if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxFileBytes) {
                    await response.body?.cancel();
                    return null;
                }
                let downloaded = 0;
                const limit = new Transform({ transform(chunk, _, done) {
                    downloaded += chunk.length;
                    if (downloaded > maxFileBytes) return done(new Error("Media file exceeds 64 MiB."));
                    done(null, chunk);
                } });
                await pipeline(response.body, limit, createWriteStream(input, { flags: "wx", mode: 0o600 }), { signal });
                // A seekable input also handles MP4 and MOV files with metadata at the end.
                return await renderAudio("ffmpeg", ["-nostdin", "-loglevel", "error", "-xerror",
                    "-protocol_whitelist", "file,pipe", "-format_whitelist", fileDemuxers, "-i", input, ...opusOutput], signal);
            } finally {
                await rm(input, { force: true });
                await rmdir(directory);
            }
        }, "opus", signal);
    }

    function remove(id) {
        const entry = audio.get(id);
        if (!entry) return;
        bytes -= entry.body.length;
        audio.delete(id);
    }

    function handleHttp(req, res) {
        if (!req.url?.startsWith(mediaPrefix)) return false;
        const match = /^([\w-]{24})\.(webm|m4a|opus)$/.exec(req.url.slice(mediaPrefix.length));
        const entry = audio.get(match?.[1]);
        if (!entry || entry.extension !== match[2] || entry.expires <= Date.now() || !["GET", "HEAD"].includes(req.method)) {
            res.writeHead(404).end();
            return true;
        }
        const length = entry.body.length;
        const headers = { "Accept-Ranges": "bytes", "Content-Type": entry.type, "Cache-Control": "private, no-store" };
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
        let start = 0;
        let end = length - 1;
        if (req.headers.range) {
            if (range?.[1]) {
                start = Number(range[1]);
                if (range[2]) end = Math.min(end, Number(range[2]));
            } else if (range?.[2]) start = Math.max(0, length - Number(range[2]));
            else start = length;
            if (start < 0 || start > end) {
                res.writeHead(416, { ...headers, "Content-Range": `bytes */${length}` }).end();
                return true;
            }
            headers["Content-Range"] = `bytes ${start}-${end}/${length}`;
        }
        headers["Content-Length"] = end - start + 1;
        res.writeHead(req.headers.range ? 206 : 200, headers);
        res.end(req.method === "HEAD" ? undefined : entry.body.subarray(start, end + 1));
        return true;
    }

    function isAvailable(track) {
        const id = cachedTracks.get(track);
        return !id || audio.get(id)?.expires > Date.now();
    }

    return { load, loadFile, loadHls, handleHttp, isAvailable, filesEnabled: Boolean(origin) };
}

module.exports = { createMediaCache };
