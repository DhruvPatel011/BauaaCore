const { execFile } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { promisify } = require("node:util");
const { ytDlpOptions } = require("./shared");

const execute = promisify(execFile);
const maxTrackBytes = 16 * 1024 * 1024;
const maxCacheBytes = 64 * 1024 * 1024;
const format = "bestaudio[protocol=https][ext=webm]/bestaudio[protocol=https][ext=m4a]";
const mediaPrefix = "/music/audio/";

function createMediaCache(address, exec = execute) {
    const audio = new Map();
    const cachedTracks = new WeakMap();
    let origin;
    let bytes = 0;
    let busy = 0;
    if (address) {
        try {
            const url = new URL(address);
            if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) origin = url.origin;
        } catch {
            console.warn("[Music] MUSIC_MEDIA_BASE_URL needs to be an HTTP or HTTPS origin.");
        }
    }

    async function cacheAudio(node, requester, command, args, fixedExtension, signal) {
        if (!origin || busy >= 2 || signal?.aborted) return null;
        busy++;
        try {
            const { stdout } = await exec(command, args, {
                timeout: 45000, encoding: "buffer", maxBuffer: maxTrackBytes, windowsHide: true, signal,
            });
            if (signal?.aborted || !Buffer.isBuffer(stdout) || stdout.length < 1024) return null;
            for (const [id, entry] of audio) if (entry.expires <= Date.now()) remove(id);
            while (bytes + stdout.length > maxCacheBytes && audio.size) remove(audio.keys().next().value);
            const id = randomBytes(18).toString("base64url");
            const extension = fixedExtension || (stdout.readUInt32BE(0) === 0x1a45dfa3 ? "webm" : "m4a");
            const type = { webm: "audio/webm", m4a: "audio/mp4", mp3: "audio/mpeg" }[extension];
            audio.set(id, { body: stdout, extension, type, expires: Date.now() + 7200000 });
            bytes += stdout.length;
            const result = await node.search({ query: `${origin}${mediaPrefix}${id}.${extension}` }, requester).catch(() => null);
            const track = signal?.aborted ? null : result?.tracks?.[0];
            if (track) cachedTracks.set(track, id);
            else remove(id);
            return track || null;
        } finally {
            busy--;
        }
    }

    function load(node, input, requester, binary, signal) {
        return cacheAudio(node, requester, binary, [...ytDlpOptions, "--max-filesize", "16M", "-q", "-f", format, "-o", "-", "--", input], undefined, signal);
    }

    function loadHls(node, input, requester, signal) {
        return cacheAudio(node, requester, "ffmpeg", ["-nostdin", "-loglevel", "error", "-xerror", "-rw_timeout", "10000000",
            "-protocol_whitelist", "https,tls,tcp,crypto", "-i", input, "-map", "0:a:0", "-c:a", "libmp3lame",
            "-b:a", "128k", "-f", "mp3", "pipe:1"], "mp3", signal);
    }

    function remove(id) {
        const entry = audio.get(id);
        if (!entry) return;
        bytes -= entry.body.length;
        audio.delete(id);
    }

    function handleHttp(req, res) {
        if (!req.url?.startsWith(mediaPrefix)) return false;
        const match = /^([\w-]{24})\.(webm|m4a|mp3)$/.exec(req.url.slice(mediaPrefix.length));
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

    return { load, loadHls, handleHttp, isAvailable };
}

module.exports = { createMediaCache };
