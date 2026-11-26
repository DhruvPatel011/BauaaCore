const { createCipheriv, createDecipheriv, createHash, randomBytes } = require("node:crypto");
const { MusicError, TRACK_LIMIT, musicText } = require("./shared");
const { queued } = require("./playback");

const spotifyCallback = "/music/spotify/callback";

function createAccounts(music, env = process.env) {
    const { data } = music;
    const secret = env.MUSIC_ACCOUNT_SECRET;
    const key = secret && createHash("sha256").update(secret).digest();
    const spotifyReady = key && env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET && env.SPOTIFY_REDIRECT_URI;
    const lastfmReady = key && env.LASTFM_API_KEY && env.LASTFM_API_SECRET;
    const pending = new Map();
    const playback = new Map();

    function encrypt(value) {
        const iv = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        return Buffer.concat([iv, cipher.update(value, "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64url");
    }

    function decrypt(value) {
        const buffer = Buffer.from(value, "base64url");
        const cipher = createDecipheriv("aes-256-gcm", key, buffer.subarray(0, 12));
        cipher.setAuthTag(buffer.subarray(-16));
        return Buffer.concat([cipher.update(buffer.subarray(12, -16)), cipher.final()]).toString("utf8");
    }

    function saveLogin(provider, userId, token) {
        for (const [id, login] of pending) {
            if (login.expires <= Date.now() || (login.provider === provider && login.userId === userId)) pending.delete(id);
        }
        if (pending.size >= 500) pending.delete(pending.keys().next().value);
        pending.set(token, { provider, userId, expires: Date.now() + 600000 });
    }

    async function fetchJson(url, options = {}) {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000), redirect: "error" });
        const json = await response.json();
        if (!response.ok || json?.error) throw new Error(`Music provider HTTP ${response.status}`);
        return json;
    }

    function spotifyToken(fields) {
        const authorization = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
        return fetchJson("https://accounts.spotify.com/api/token", {
            method: "POST", headers: { Authorization: `Basic ${authorization}` }, body: new URLSearchParams(fields),
        });
    }

    function spotifyApi(token, path) {
        return fetchJson(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    }

    async function spotify(interaction, options) {
        const ctx = await music.guard(interaction, "spotify", { voice: Boolean(options.id) });
        const id = `spotify:${ctx.userId}`;
        if (options.sub === "logout") {
            for (const [state, login] of pending) if (login.provider === "spotify" && login.userId === ctx.userId) pending.delete(state);
            await data.change(id, {}, () => ({}));
            return "Spotify account disconnected from BauaaCore.";
        }
        if (!spotifyReady) throw new MusicError("Spotify account linking needs a configured Spotify developer app. Public Spotify URLs work with `/play` when the tracks are visible.");
        if (options.sub === "login") {
            const state = randomBytes(24).toString("base64url");
            saveLogin("spotify", ctx.userId, state);
            const url = new URL("https://accounts.spotify.com/authorize");
            url.search = new URLSearchParams({ client_id: env.SPOTIFY_CLIENT_ID, response_type: "code", redirect_uri: env.SPOTIFY_REDIRECT_URI,
                scope: "playlist-read-private playlist-read-collaborative", state });
            return `[Authorize BauaaCore on Spotify](${url}). This link expires in 10 minutes.`;
        }
        const account = await data.read(id);
        if (!account.refresh) throw new MusicError("Link your Spotify account with `/spotify login` first.");
        try {
            const tokens = await spotifyToken({ grant_type: "refresh_token", refresh_token: decrypt(account.refresh) });
            if (tokens.refresh_token) await data.change(id, {}, previous => previous.refresh === account.refresh ?
                { refresh: encrypt(tokens.refresh_token) } : previous);
            if (!options.id) {
                const page = options.page || 1;
                const result = await spotifyApi(tokens.access_token, `me/playlists?limit=10&offset=${(page - 1) * 10}`);
                const rows = result.items?.filter(Boolean).map(item => `**${musicText(item.name, 75)}** · \`${item.id}\``) || [];
                return rows.length ? `${rows.join("\n")}\n\nPage ${page} · Use \`/spotify playlists id:\` to queue a playlist.` : "No Spotify playlists on this page.";
            }
            if (!/^[A-Za-z0-9]{22}$/.test(options.id)) throw new MusicError("Enter a Spotify playlist ID from `/spotify playlists`.");
            const tracks = [];
            for (let offset = 0; offset < TRACK_LIMIT; offset += 50) {
                const result = await spotifyApi(tokens.access_token, `playlists/${options.id}/items?limit=50&offset=${offset}`);
                for (const item of result.items || []) {
                    const track = item.item || item.track;
                    if (!track?.id || track.type !== "track" || !track.artists?.length) continue;
                    tracks.push({ kind: "match", title: track.name, author: track.artists.map(artist => artist.name).join(", "),
                        duration: track.duration_ms, url: `https://open.spotify.com/track/${track.id}`, source: "spotify" });
                }
                if (!result.next) break;
            }
            return queued(await music.enqueue(interaction, ctx, tracks, { stored: true }), "your Spotify playlist");
        } catch (error) {
            if (error instanceof MusicError) throw error;
            throw new MusicError("Spotify couldn’t load this account or playlist. Check that your account and the playlist are accessible to this Spotify app.");
        }
    }

    function handleHttp(req, res) {
        if (!req.url?.startsWith(`${spotifyCallback}?`) && req.url !== spotifyCallback) return false;
        const url = new URL(req.url, "http://localhost");
        const finish = (status, message) => {
            res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
            res.end(message);
        };
        const state = url.searchParams.get("state");
        const login = pending.get(state);
        if (req.method !== "GET" || !spotifyReady || login?.provider !== "spotify" || login.expires <= Date.now()) {
            finish(400, "This Spotify login link is invalid or expired. Run /spotify login again in Discord.");
            return true;
        }
        pending.delete(state);
        const code = url.searchParams.get("code");
        if (!code) {
            finish(400, "Spotify authorization was not completed.");
            return true;
        }
        void spotifyToken({ grant_type: "authorization_code", code, redirect_uri: env.SPOTIFY_REDIRECT_URI })
            .then(tokens => data.change(`spotify:${login.userId}`, {}, () => ({ refresh: encrypt(tokens.refresh_token) })))
            .then(() => finish(200, "Spotify connected to BauaaCore. Return to Discord and run /spotify playlists."))
            .catch(() => finish(502, "Spotify login failed. Run /spotify login again in Discord."));
        return true;
    }

    async function lastfmApi(method, fields = {}) {
        const params = { ...fields, method, api_key: env.LASTFM_API_KEY };
        const text = Object.keys(params).sort().map(name => `${name}${params[name]}`).join("");
        const api_sig = createHash("md5").update(`${text}${env.LASTFM_API_SECRET}`).digest("hex");
        const body = new URLSearchParams({ ...params, api_sig, format: "json" });
        if (method.startsWith("auth.")) return fetchJson(`https://ws.audioscrobbler.com/2.0/?${body}`);
        return fetchJson("https://ws.audioscrobbler.com/2.0/", { method: "POST", body });
    }

    async function lastfm(interaction, options) {
        const { userId } = await music.guard(interaction, "lastfm");
        const id = `lastfm:${userId}`;
        const pendingLogin = [...pending].find(([, login]) => login.provider === "lastfm" && login.userId === userId);
        if (options.sub === "logout") {
            if (pendingLogin) pending.delete(pendingLogin[0]);
            await data.change(id, {}, () => ({}));
            return "Last.fm disconnected from BauaaCore.";
        }
        if (!lastfmReady) throw new MusicError("Last.fm needs API credentials configured by the bot operator.");
        if (options.sub === "scrobble") {
            const result = await data.change(id, {}, previous => {
                if (!previous.session) throw new MusicError("Connect your Last.fm account with `/lastfm login`.");
                return { ...previous, enabled: options.enabled ?? !previous.enabled };
            });
            return `Last.fm scrobbling is ${result.enabled ? "on" : "off"}.`;
        }
        if (pendingLogin?.[1].expires > Date.now()) {
            try {
                const token = pendingLogin[0];
                const { session } = await lastfmApi("auth.getSession", { token });
                await data.change(id, {}, () => ({ session: encrypt(session.key), enabled: false }));
                pending.delete(token);
                return `Connected Last.fm account **${musicText(session.name)}**. Use \`/lastfm scrobble\` to enable scrobbling.`;
            } catch {
                const link = `https://www.last.fm/api/auth/?${new URLSearchParams({ api_key: env.LASTFM_API_KEY, token: pendingLogin[0] })}`;
                return `Finish [Last.fm authorization](${link}), then run \`/lastfm login\` again.`;
            }
        }
        const { token } = await lastfmApi("auth.getToken").catch(() => { throw new MusicError("Last.fm authorization is unavailable."); });
        saveLogin("lastfm", userId, token);
        const link = `https://www.last.fm/api/auth/?${new URLSearchParams({ api_key: env.LASTFM_API_KEY, token })}`;
        return `Open [Last.fm authorization](${link}), approve access, then run \`/lastfm login\` again.`;
    }

    function stopListening(player) {
        clearInterval(playback.get(player.guildId)?.timer);
        playback.delete(player.guildId);
    }

    if (lastfmReady && music.manager) {
        music.manager.on("trackStart", (player, track) => {
            stopListening(player);
            if (!track?.info || track.info.isStream || track.info.duration < 30000 || track.info.sourceName === "flowery-tts") return;
            const listening = new Map();
            const submitted = new Set();
            const threshold = Math.min(track.info.duration / 2, 240000);
            let lastCheck = Date.now();
            const timer = setInterval(() => {
                const now = Date.now();
                const elapsed = Math.min(5500, now - lastCheck);
                lastCheck = now;
                if (player.paused || !player.playing || !player.connected || player.queue.current?.encoded !== track.encoded) return;
                const channel = music.voiceChannel(player);
                for (const member of channel?.members.values() || []) {
                    if (member.user.bot || member.voice.deaf || member.voice.selfDeaf || submitted.has(member.id)) continue;
                    const row = listening.get(member.id) || { ms: 0, since: Math.floor((now - elapsed) / 1000) };
                    row.ms += elapsed;
                    if (row.ms < threshold) { listening.set(member.id, row); continue; }
                    listening.delete(member.id);
                    submitted.add(member.id);
                    void data.read(`lastfm:${member.id}`).then(account => {
                        if (!account.session || !account.enabled) return;
                        return lastfmApi("track.scrobble", { sk: decrypt(account.session), artist: track.info.author,
                            track: track.info.title, timestamp: row.since });
                    }).catch(() => {});
                }
            }, 2000);
            timer.unref();
            playback.set(player.guildId, { timer });
        });
        music.manager.on("queueEnd", stopListening);
        music.manager.on("playerDestroy", stopListening);
    }

    return { spotify, lastfm, handleHttp };
}

module.exports = { createAccounts };
