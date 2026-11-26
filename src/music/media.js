const { execFile } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { promisify } = require("node:util");

const execute = promisify(execFile);
const maxTrackBytes = 16 * 1024 * 1024;
const maxCacheBytes = 64 * 1024 * 1024;
const format = "bestaudio[protocol=https][ext=webm]/bestaudio[protocol=https][ext=m4a]";
const mediaPrefix = "/music/audio/";

function createMediaCache(address, exec = execute) {
    const audio = new Map();
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

    async function load(node, input, requester, binary) {
        if (!origin || busy >= 2) return null;
        busy++;
        try {
            const { stdout } = await exec(binary, ["--ignore-config", "--no-warnings", "--js-runtimes", "node", "--no-playlist",
                "--max-filesize", "16M", "-q", "-f", format, "-o", "-", "--", input], {
                timeout: 28000, encoding: "buffer", maxBuffer: maxTrackBytes, windowsHide: true,
            });
            if (!Buffer.isBuffer(stdout) || stdout.length < 1024) return null;
            for (const [id, entry] of audio) if (entry.expires <= Date.now()) remove(id);
            while (bytes + stdout.length > maxCacheBytes && audio.size) remove(audio.keys().next().value);
            const id = randomBytes(18).toString("base64url");
            const webm = stdout.readUInt32BE(0) === 0x1a45dfa3;
            audio.set(id, { body: stdout, type: webm ? "audio/webm" : "audio/mp4", expires: Date.now() + 7200000 });
            bytes += stdout.length;
            const result = await node.search({ query: `${origin}${mediaPrefix}${id}.${webm ? "webm" : "m4a"}` }, requester);
            if (!result.tracks?.length) remove(id);
            return result.tracks?.[0] || null;
        } catch {
            return null;
        } finally {
            busy--;
        }
    }

    function remove(id) {
        bytes -= audio.get(id).body.length;
        audio.delete(id);
    }

    function handleHttp(req, res) {
        if (!req.url?.startsWith(mediaPrefix)) return false;
        const id = /^([\w-]{24})\.(?:webm|m4a)$/.exec(req.url.slice(mediaPrefix.length))?.[1];
        const entry = audio.get(id);
        if (!entry || entry.expires <= Date.now() || !["GET", "HEAD"].includes(req.method)) {
            res.writeHead(404).end();
            return true;
        }
        const length = entry.body.length;
        const headers = { "Accept-Ranges": "bytes", "Content-Type": entry.type, "Cache-Control": "private, no-store" };
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
        let start = 0;
        let end = length - 1;
        if (req.headers.range) {
            if (match?.[1]) {
                start = Number(match[1]);
                if (match[2]) end = Math.min(end, Number(match[2]));
            } else if (match?.[2]) start = Math.max(0, length - Number(match[2]));
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

    return { load, handleHttp };
}

module.exports = { createMediaCache };
