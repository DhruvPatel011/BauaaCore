const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { EventEmitter, once } = require("node:events");
const { createRequire } = require("node:module");
const { setTimeout: delay } = require("node:timers/promises");
const { ChannelType, Collection, MessageFlags, PermissionsBitField } = require("discord.js");
const { WebSocketServer } = createRequire(require.resolve("lavalink-client"))("ws");
const { installMusic, definitions, slashData } = require("../src/music/commands");
const { library, defaultSettings } = require("../src/music/library");
const { createMediaCache } = require("../src/music/media");
const { checkedQuery, parseSpotifyEmbed, matchTrack, matchSoundCloudTrack, directProviderTrack } = require("../src/music/sources");

const guildId = "111111111111111111";
const voiceId = "222222222222222222";
const textId = "333333333333333333";
const botId = "444444444444444444";
const userId = "555555555555555555";
const spotifyId = "37i9dQZF1DXcBWIGoYBM5M";

test("all music commands serialize within Discord’s registration limits", () => {
    const commands = definitions.map(slashData).map(builder => builder.toJSON());
    const names = new Set(commands.map(item => item.name));
    assert.equal(names.size, commands.length);
    assert.ok(commands.length + 14 <= 100);
    for (const name of ["play", "playfile", "search", "playlist", "247", "8d", "spotify", "lastfm"]) assert.ok(names.has(name));
});

test("Spotify’s public embed yields ordered metadata and matching rejects a different song", async () => {
    const payload = { props: { pageProps: { state: { data: { entity: { name: "Test playlist", trackList: [
        { uri: "spotify:track:4HCOHRCSQelz2GPX8iTamO", title: "A track", subtitle: "The artist", duration: 180000 },
        { uri: "spotify:episode:4HCOHRCSQelz2GPX8iTamO", title: "Episode", subtitle: "Host", duration: 400000 },
        { uri: "spotify:track:37i9dQZF1DXcBWIGoYBM5M", title: "Second", subtitle: "Other artist", duration: 140000 },
    ] } } } } } };
    const result = parseSpotifyEmbed(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>`, "playlist", spotifyId);
    assert.deepEqual(result.tracks.map(track => track.title), ["A track", "Second"]);
    assert.equal(result.tracks[0].kind, "match");
    const correct = { info: { title: "A track", author: "The artist - Topic", duration: 180500 } };
    const wrong = { info: { title: "Another track", author: "The artist", duration: 180000 } };
    const node = { search: async ({ source }) => ({ tracks: source === "ytsearch" ? [wrong] : [correct] }) };
    assert.equal(await matchTrack(node, result.tracks[0], { id: userId }), correct);
    assert.equal(checkedQuery(`spotify:playlist:${spotifyId}`).href, `https://open.spotify.com/playlist/${spotifyId}`);
    assert.equal(checkedQuery("https://audio.example/song.mp3", ["audio.example"]).hostname, "audio.example");
    for (const url of ["http://127.0.0.1/audio.mp3", "file:///music.mp3", "https://youtube.com.fake.test/file.mp3", "https://evil@youtube.com/file.mp3"]) {
        assert.throws(() => checkedQuery(url), /supported streaming link/);
    }
});

test("playlist edits survive simultaneous writes and remain private by user ID", async () => {
    const entries = new Map();
    const db = { collection: () => ({
        async findOne({ _id }) { return structuredClone(entries.get(_id)); },
        async insertOne(doc) {
            if (entries.has(doc._id)) throw Object.assign(new Error("Duplicate"), { code: 11000 });
            entries.set(doc._id, structuredClone(doc));
        },
        async updateOne(filter, write) {
            const doc = entries.get(filter._id);
            if (doc.revision !== filter.revision) return { matchedCount: 0 };
            entries.set(filter._id, { ...doc, ...structuredClone(write.$set), revision: doc.revision + write.$inc.revision });
            return { matchedCount: 1 };
        },
    }) };
    const data = library(() => db);
    await data.editPlaylist(userId, "Test Playlist", item => item, true);
    await Promise.all(["A", "B"].map(title => data.editPlaylist(userId, "Test Playlist", item => ({ ...item, tracks: [...item.tracks, { title }] }))));
    assert.deepEqual((await data.getPlaylist(userId, "test playlist")).tracks.map(track => track.title).sort(), ["A", "B"]);
    await assert.rejects(data.getPlaylist(botId, "Test Playlist"), /don’t have a playlist/);
});

test("yt-dlp supplies an HTTP audio track while preserving the original link and title", async () => {
    const video = "https://www.youtube.com/watch?v=abcdefghijk";
    const media = "https://rr1.googlevideo.com/videoplayback?signature=short-lived";
    const track = { encoded: "engine-track", info: { sourceName: "http", uri: media, title: "Unknown title", duration: 20000 } };
    const testNode = { search: async query => {
        assert.deepEqual(query, { query: media });
        return { tracks: [track] };
    } };
    const ready = await directProviderTrack(testNode, video, { id: userId }, "yt-dlp", async (binary, args) => {
        assert.equal(binary, "yt-dlp");
        assert.deepEqual(args.slice(-2), ["--", video]);
        return { stdout: JSON.stringify({ url: media, title: "A Video", author: "Creator", duration: 20, id: "abcdefghijk" }) };
    });
    assert.equal(ready.encoded, "engine-track");
    assert.equal(ready.info.uri, video);
    assert.equal(ready.info.title, "A Video");
    assert.equal(ready.info.sourceName, "youtube");
    assert.equal(await directProviderTrack(testNode, video, { id: userId }, "yt-dlp", async () => ({
        stdout: JSON.stringify({ url: "https://googlevideo.com.attacker.example/stream" }),
    })), null);
});

test("audio fallback serves private links and byte ranges for Lavalink seeking", async t => {
    const body = Buffer.alloc(2048, 9);
    body.writeUInt32BE(0x1a45dfa3);
    let media;
    const server = http.createServer((req, res) => { if (!media.handleHttp(req, res)) res.writeHead(404).end(); });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => server.close());
    media = createMediaCache(`http://127.0.0.1:${server.address().port}`, async () => ({ stdout: body }));
    const result = await media.load({ async search({ query }) {
        const head = await fetch(query, { method: "HEAD" });
        assert.equal(head.headers.get("content-length"), "2048");
        const range = await fetch(query, { headers: { Range: "bytes=5-9" } });
        assert.equal(range.status, 206);
        assert.equal(range.headers.get("content-range"), "bytes 5-9/2048");
        assert.deepEqual(Buffer.from(await range.arrayBuffer()), body.subarray(5, 10));
        const invalid = await fetch(query, { headers: { Range: "bytes=2048-" } });
        assert.equal(invalid.status, 416);
        assert.equal((await fetch(query.replace(/\/[^/]+$/, "/unknown.webm"))).status, 404);
        return { tracks: [{ encoded: "cached-audio" }] };
    } }, "https://www.youtube.com/watch?v=abcdefghijk", { id: userId }, "yt-dlp");
    assert.deepEqual(result, { encoded: "cached-audio" });
});

test("YouTube playback prefers audio served by the bot and still supports direct streams", async () => {
    const video = "https://www.youtube.com/watch?v=abcdefghijk";
    const media = "https://rr1.googlevideo.com/videoplayback?signature=short-lived";
    const requester = { id: userId };
    const extract = async () => ({ stdout: JSON.stringify({ url: media, title: "A Video" }) });
    const httpTrack = encoded => ({ encoded, info: { sourceName: "http", title: "Unknown title" } });
    const requests = [];
    const node = { search: async ({ query }) => {
        requests.push(query);
        return { tracks: [httpTrack("direct-audio")] };
    } };
    const hosted = await directProviderTrack(node, video, requester, "yt-dlp", extract,
        async (...args) => {
            assert.deepEqual(args, [node, video, requester, "yt-dlp"]);
            return httpTrack("hosted-audio");
        });
    assert.equal(hosted.encoded, "hosted-audio");
    assert.equal(hosted.info.uri, video);
    assert.deepEqual(requests, []);

    const direct = await directProviderTrack(node, video, requester, "yt-dlp", extract, async () => null);
    assert.equal(direct.encoded, "direct-audio");
    assert.deepEqual(requests, [media]);
});

test("SoundCloud fallback matches the recording and rejects remixes and different artists", async () => {
    const video = { info: { title: "Artist - Song (Official Video)", author: "Artist", duration: 180000 } };
    const song = { encoded: "song", info: { title: "Song", author: "Artist", duration: 179000, sourceName: "soundcloud" } };
    const remix = { ...song, encoded: "remix", info: { ...song.info, title: "Song (Remix)" } };
    const cover = { ...song, encoded: "cover", info: { ...song.info, author: "Someone Else" } };
    const node = { async search({ query, source }) {
        assert.deepEqual({ query, source }, { query: "song Artist", source: "scsearch" });
        return { tracks: [remix, cover, song] };
    } };
    assert.equal(await matchSoundCloudTrack(node, video, { id: userId }), song);
    assert.equal(await matchSoundCloudTrack({ search: async () => ({ tracks: [remix, cover] }) }, video, { id: userId }), null);
});

function rawTrack(id, title) {
    return { encoded: `encoded-${id}`, info: { identifier: id, title, author: "Artist", length: 90000, isSeekable: true,
        isStream: false, sourceName: "youtube", uri: `https://www.youtube.com/watch?v=${id}` }, pluginInfo: {}, userData: {} };
}

async function waitFor(predicate) {
    for (let n = 0; n < 100; n++) {
        if (predicate()) return;
        await delay(25);
    }
    assert.fail("Timed out waiting for a music event");
}

test("music controls update one public panel without routine replies and preserve private results and errors", { timeout: 15000 }, async t => {
    const tracks = [rawTrack("first-track", "First song"), rawTrack("secondtrack", "Second song")];
    const alternate = { ...rawTrack("soundcloud-first", "First song"),
        info: { ...tracks[0].info, identifier: "soundcloud-first", sourceName: "soundcloud", uri: "https://soundcloud.com/artist/first-song" } };
    const sent = [];
    const voiceUpdates = [];
    const cards = [];
    let connection;
    let current = null;
    let paused = false;
    let volume = 70;
    const send = event => connection.send(JSON.stringify(event));
    function end(reason = "finished") {
        const track = current;
        current = null;
        if (track) send({ op: "event", type: "TrackEndEvent", guildId, track, reason });
    }
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, "http://localhost");
        res.setHeader("Content-Type", "application/json");
        if (url.pathname === "/v4/info") return res.end(JSON.stringify({ version: { semver: "4.2.2" }, sourceManagers: ["youtube", "soundcloud", "http"], plugins: [] }));
        if (url.pathname === "/version") return res.end("4.2.2");
        if (url.pathname === "/v4/loadtracks") {
            const identifier = url.searchParams.get("identifier");
            if (identifier.startsWith("ytsearch:")) return res.end(JSON.stringify({ loadType: "search", data: tracks }));
            if (identifier.startsWith("scsearch:")) return res.end(JSON.stringify({ loadType: "search", data: [alternate] }));
            return res.end(JSON.stringify({ loadType: "playlist", data: { info: { name: "Test playlist", selectedTrack: -1 }, tracks } }));
        }
        if (req.method === "DELETE") { res.statusCode = 204; return res.end(); }
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks).toString() || "{}");
        if (payload.voice) voiceUpdates.push(payload.voice);
        if (payload.volume != null) volume = payload.volume;
        if (payload.paused != null) paused = payload.paused;
        if (payload.track) {
            if (!payload.track.encoded) end("stopped");
            else {
                current = [...tracks, alternate].find(item => item.encoded === payload.track.encoded);
                sent.push(current.info.title);
                send({ op: "event", type: "TrackStartEvent", guildId, track: current });
            }
        }
        res.end(JSON.stringify({ guildId, track: current, volume, paused, state: { time: Date.now(), position: 0, connected: true, ping: 1 } }));
    });
    const socket = new WebSocketServer({ server });
    socket.on("connection", ws => {
        connection = ws;
        send({ op: "ready", resumed: false, sessionId: "lavalink-session" });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => { for (const ws of socket.clients) ws.terminate(); socket.close(); server.close(); });
    const client = new EventEmitter();
    client.user = { id: botId, username: "BauaaCore" };
    const member = { id: userId, user: { id: userId, bot: false }, roles: { cache: new Collection() } };
    const permissions = new PermissionsBitField(PermissionsBitField.All);
    const voice = { id: voiceId, type: ChannelType.GuildVoice, permissionsFor: () => permissions, joinable: true,
        members: new Collection([[userId, member]]) };
    const guild = { id: guildId, members: { cache: new Collection([[userId, member]]), me: { id: botId } },
        voiceStates: { cache: new Collection([[userId, { channel: voice }]]) }, channels: { cache: new Collection([[voiceId, voice]]) } };
    guild.shard = { send: packet => {
        if (!packet.d.channel_id) return;
        client.emit("raw", { t: "VOICE_SERVER_UPDATE", d: { guild_id: guildId, endpoint: "discord.voice.test:443", token: "test-voice-token" } });
        client.emit("raw", { t: "VOICE_STATE_UPDATE", d: { guild_id: guildId, user_id: botId, channel_id: voiceId, session_id: "voice-session" } });
    } };
    client.guilds = { cache: new Collection([[guildId, guild]]) };
    const text = { id: textId, isSendable: () => true, async send(payload) {
        const card = { channelId: textId, url: `https://discord.com/channels/${guildId}/${textId}/666666666666666666`,
            payload, async edit(next) { this.payload = next; return this; } };
        cards.push(card);
        return card;
    } };
    client.channels = { cache: guild.channels.cache, fetch: async id => id === textId ? text : null };
    const settings = { ...defaultSettings, djRole: "666666666666666666", djCommands: ["skip"] };
    const music = installMusic(client, { data: { settings: async () => settings }, env: {
        LAVALINK_URL: `http://127.0.0.1:${server.address().port}`, LAVALINK_PASSWORD: "test-password",
        MUSIC_YTDLP_PATH: "./missing-test-yt-dlp",
    } });
    t.after(async () => { await music.close(); });
    await music.start();
    await waitFor(() => {
        const node = music.manager.nodeManager.nodes.get("primary");
        return node?.sessionId && node.info;
    });
    function interaction(values) {
        return { guild, guildId, channelId: textId, inGuild: () => true, user: member.user, member,
            memberPermissions: new PermissionsBitField(), options: {
                getString: key => values[key], getBoolean: key => values[key], getInteger: key => values[key],
            },
            deferReply: async function (reply) { assert.equal(reply.flags, MessageFlags.Ephemeral); },
            editReply: async function (reply) { this.output = reply; },
            deleteReply: async function () { this.deleted = true; },
        };
    }
    const play = interaction({ query: "https://www.youtube.com/playlist?list=demo" });
    await music.commands.find(item => item.data.name === "play").execute(play);
    assert.equal(play.deleted, true);
    assert.equal(play.output, undefined);
    assert.deepEqual(voiceUpdates, [{ token: "test-voice-token", endpoint: "discord.voice.test:443", sessionId: "voice-session", channelId: voiceId }]);
    await waitFor(() => sent.length === 1 && cards.length === 1);
    const now = interaction({});
    await music.commands.find(item => item.data.name === "nowplaying").execute(now);
    assert.equal(now.output.content, `[Open the music controller](${cards[0].url})`);
    const volumeCommand = music.commands.find(item => item.data.name === "volume");
    const setVolume = interaction({ level: 50 });
    await volumeCommand.execute(setVolume);
    assert.equal(setVolume.deleted, true);
    assert.equal(setVolume.output, undefined);
    const getVolume = interaction({});
    await volumeCommand.execute(getVolume);
    assert.match(getVolume.output.content, /50%/);
    const rows = cards[0].payload.components.map(row => row.toJSON().components);
    assert.deepEqual(rows.map(row => row.map(button => button.label)), [
        ["Previous", "Pause", "Skip", "Replay"],
        ["Queue", "Shuffle", "Loop", "Autoplay"],
        ["Like", "Unlike", "Lyrics", "Save DM"],
        ["Vote skip", "Open", "Stop", "Leave"],
    ]);
    const buttons = rows.flat();
    const button = label => ({ ...interaction({}), isButton: () => true, isStringSelectMenu: () => false,
        customId: buttons.find(item => item.label === label).custom_id, message: { flags: { has: () => false } },
        deferUpdate: async () => {}, async followUp(payload) { this.output = payload; } });
    const pause = button("Pause");
    await music.component(pause);
    assert.equal(pause.output, undefined);
    assert.equal(paused, true);
    await waitFor(() => cards[0].payload.embeds[0].toJSON().title === "Paused");
    const queue = button("Queue");
    await music.component(queue);
    assert.match(queue.output.embeds[0].toJSON().description, /Second song/);
    assert.equal(queue.output.flags, MessageFlags.Ephemeral);
    const denied = button("Skip");
    await music.component(denied);
    assert.match(denied.output.content, /requires the DJ role/);
    assert.deepEqual(sent, ["First song"]);
    member.roles.cache.set(settings.djRole, {});
    const skip = button("Skip");
    await music.component(skip);
    assert.equal(skip.output, undefined);
    await waitFor(() => sent.length === 2);
    assert.deepEqual(sent, ["First song", "Second song"]);
    end();
    await waitFor(() => !music.playerFor(guildId)?.queue.current);
    const leave = button("Leave");
    await music.component(leave);
    assert.equal(leave.output, undefined);
    await waitFor(() => cards[0].payload.embeds[0].toJSON().description.includes("Join a voice channel"));

    const search = interaction({ query: "First song" });
    await music.commands.find(item => item.data.name === "search").execute(search);
    const menu = search.output.components[0].toJSON().components[0];
    const select = { ...interaction({}), values: ["0"], customId: menu.custom_id,
        deferUpdate: async () => {}, isStringSelectMenu: () => true,
        async followUp(reply) { this.output = reply; } };
    await music.component(select);
    assert.equal(select.deleted, true);
    assert.equal(select.output, undefined);
    await waitFor(() => cards[0].payload.embeds[0].toJSON().description.includes("First song"));
    assert.equal(cards.length, 1);
    assert.equal(current.info.sourceName, "youtube");

    end();
    await waitFor(() => !music.playerFor(guildId)?.queue.current);
    const playByName = interaction({ query: "First song" });
    await music.commands.find(item => item.data.name === "play").execute(playByName);
    await waitFor(() => current?.info.sourceName === "soundcloud");
    assert.equal(playByName.deleted, true);
});
