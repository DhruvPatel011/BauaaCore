const test = require("node:test");
const assert = require("node:assert/strict");
const { ChannelType, Collection, OverwriteType, PermissionFlagsBits, PermissionsBitField } = require("discord.js");
const { createFakeDb } = require("./fakeDb");

const db = createFakeDb();
const databasePath = require.resolve("../src/config/database");
require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: { getDatabase: () => db },
};

const { getLogChannel, getLoggingStatus, setupLogging } = require("../src/utils/logger");
const { shouldSkipIgnoredEvent } = require("../src/utils/ignoreManager");
const { createHealthHandler } = require("../src/utils/health");
const messageDelete = require("../src/events/messageDelete");
const bulkDelete = require("../src/events/messageDeleteBulk");
const voiceStateUpdate = require("../src/events/voiceStateUpdate");
const ignore = require("../src/commands/ignore");
const logsStatus = require("../src/commands/logsStatus");

const VIEW = PermissionFlagsBits.ViewChannel;
const SEND = PermissionFlagsBits.SendMessages;
const EMBED = PermissionFlagsBits.EmbedLinks;
let nextId = 100000000000000000n;
const newId = () => String(++nextId);

function createGuild() {
    const guildId = newId();
    const everyone = { id: guildId };
    const bot = { id: newId(), permissions: new PermissionsBitField(PermissionFlagsBits.ViewAuditLog) };
    const cache = new Collection();
    const created = [];
    const guild = {
        id: guildId,
        roles: { everyone },
        members: { me: bot },
        channels: {
            cache,
            async create({ name, type, parent, permissionOverwrites }) {
                const isPrivate = permissionOverwrites.some(entry =>
                    entry.id === everyone.id && entry.deny?.includes(VIEW)
                );
                const channel = addChannel(name, { type, parentId: parent, isPrivate });
                created.push(channel);
                return channel;
            },
        },
        fetchAuditLogs: async () => ({ entries: new Collection() }),
    };

    function addChannel(name, { type = ChannelType.GuildText, parentId, isPrivate = true } = {}) {
        const channel = {
            id: newId(),
            name,
            guild,
            type,
            parentId,
            permissionOverwrites: { cache: new Collection() },
            everyonePermissions: new PermissionsBitField(isPrivate ? [] : VIEW),
            botPermissions: new PermissionsBitField([VIEW, SEND, EMBED]),
            permissionsFor(target) {
                return target === everyone ? this.everyonePermissions : this.botPermissions;
            },
            sent: [],
            async send(payload) {
                this.sent.push(payload);
            },
            toString() {
                return `<#${this.id}>`;
            },
        };
        if (isPrivate) {
            channel.permissionOverwrites.cache.set(everyone.id, {
                id: everyone.id, deny: new PermissionsBitField(VIEW),
            });
        }
        cache.set(channel.id, channel);
        return channel;
    }

    return { guild, addChannel, created };
}

function executeAdminCommand(command, guild, options = {}) {
    const interaction = {
        inGuild: () => true,
        memberPermissions: new PermissionsBitField(PermissionFlagsBits.Administrator),
        guild,
        guildId: guild.id,
        deferReply: async () => {},
        editReply: async reply => reply,
        ...options,
    };
    return command.execute(interaction);
}

test("logging migrates unambiguous private legacy destinations and follows the saved ID after rename", async () => {
    const { guild, addChannel } = createGuild();
    const publicChannel = addChannel("deleted-msg-logs", { isPrivate: false });
    const category = addChannel("All Log & Info", { type: ChannelType.GuildCategory });
    const destination = addChannel("deleted-msg-logs", { parentId: category.id });
    addChannel("edited-msg-logs", { parentId: category.id });
    addChannel("edited-msg-logs", { parentId: category.id });
    const unprotected = addChannel("vc-logs", { parentId: category.id, isPrivate: false });
    unprotected.everyonePermissions = new PermissionsBitField();

    assert.equal(await getLogChannel(guild, "messages"), destination);
    assert.equal(await getLogChannel(guild, "editedMessages"), null);
    assert.equal(await getLogChannel(guild, "voice"), null);
    assert.deepEqual(await db.collection("guild_log_config").findOne({ _id: guild.id }), {
        _id: guild.id,
        categoryId: category.id,
        channels: { messages: destination.id },
    });

    destination.name = "private-message-audit";
    assert.equal(await getLogChannel(guild, "messages"), destination);
    destination.parentId = null;
    assert.equal(await getLogChannel(guild, "messages"), null);
    assert.equal(publicChannel.sent.length, 0);
});

test("setup saves private destinations, repairs invalid IDs, and logs-status reports permissions", async () => {
    const { guild, created } = createGuild();
    const [first, second] = await Promise.all([setupLogging(guild), setupLogging(guild)]);
    assert.equal(first, second);
    assert.equal(created.length, 10);
    assert.equal(await getLogChannel(guild, "all"), first.all);

    first.all.everyonePermissions = new PermissionsBitField(VIEW);
    first.messages.botPermissions = new PermissionsBitField(VIEW);
    guild.members.me.permissions = new PermissionsBitField();
    const staffRole = newId();
    first.voice.permissionOverwrites.cache.set(staffRole, {
        id: staffRole, type: OverwriteType.Role, allow: new PermissionsBitField(VIEW),
    });
    assert.equal(await getLogChannel(guild, "all"), null);
    assert.equal(await getLogChannel(guild, "messages"), null);

    const status = await executeAdminCommand(logsStatus, guild);
    assert.match(status.content, /missing View Audit Log permission/);
    assert.match(status.content, /Must deny View Channel to @everyone/);
    assert.match(status.content, /Bot needs View Channel, Send Messages, and Embed Links/);
    assert.ok(status.content.includes(`Explicit access: <@&${staffRole}>`));

    const repaired = await setupLogging(guild);
    assert.notEqual(repaired.all.id, first.all.id);
    assert.equal(await getLogChannel(guild, "all"), repaired.all);
    assert.equal(repaired.messages.id, first.messages.id);
    assert.equal(created.length, 11);
    guild.channels.cache.delete(repaired.all.id);
    const missing = await getLoggingStatus(guild);
    assert.equal(missing.destinations.find(({ name }) => name === "all-logs").issue, "Saved channel is missing");
});

test("bulk deletion skips ignored authors and webhooks while logging the remaining messages", async () => {
    const { guild, addChannel } = createGuild();
    const channels = await setupLogging(guild);
    const source = addChannel("chat");
    const ignoredUser = newId();
    const ignoredWebhook = newId();
    for (const id of [ignoredUser, ignoredWebhook]) {
        await db.collection("ignored_entities").insertOne({ guildId: guild.id, id });
    }
    const ignored = { author: { id: ignoredUser } };
    const webhook = { webhookId: ignoredWebhook };
    const visible = { author: { id: newId() } };
    const messages = new Collection([[newId(), ignored], [newId(), webhook], [newId(), visible]]);

    assert.equal(await shouldSkipIgnoredEvent("messageDeleteBulk", [messages, source]), false);
    await Promise.all([
        bulkDelete.execute(messages, source),
        bulkDelete.execute(new Collection([...messages].reverse()), source),
    ]);
    const details = channels.messages.sent[0].embeds[0].toJSON();
    const summary = channels.all.sent[0].embeds[0].toJSON();
    assert.match(details.description, /`1` messages/);
    assert.match(summary.description, /`1` messages/);

    messages.sweep(message => message === visible);
    await bulkDelete.execute(messages, source);
    assert.equal(channels.messages.sent.length, 1);
    assert.equal(channels.all.sent.length, 1);
});

test("duplicate delivery of a message deletion writes one log per destination", async () => {
    const { guild, addChannel } = createGuild();
    const channels = await setupLogging(guild);
    const channel = addChannel("chat");
    const message = { id: newId(), guild, channel, author: { id: newId(), tag: "Member" }, content: "Deleted text" };
    await Promise.all([messageDelete.execute(message), messageDelete.execute({ ...message })]);
    assert.equal(channels.messages.sent.length, 1);
    assert.equal(channels.all.sent.length, 1);
    await messageDelete.execute({ ...message, id: newId() });
    assert.equal(channels.messages.sent.length, 2);
    assert.equal(channels.all.sent.length, 2);
});

test("voice channel activity skips bots and logs each join and leave when the session ID repeats", async () => {
    const { guild, addChannel } = createGuild();
    const logs = await setupLogging(guild);
    const voice = addChannel("voice", { type: ChannelType.GuildVoice });
    const otherVoice = addChannel("other-voice", { type: ChannelType.GuildVoice });
    function member(bot) {
        const id = newId();
        return { user: { id, bot, tag: bot ? "Music Bot" : "Member", displayAvatarURL: () => "https://example.com/avatar.png" },
            toString: () => `<@${id}>` };
    }
    const bot = member(true);
    const botInVoice = { guild, member: bot, channel: voice, sessionId: "bot-session" };
    const botOutOfVoice = { ...botInVoice, channel: null };
    const botMoved = { ...botInVoice, channel: otherVoice };
    await voiceStateUpdate.execute(botOutOfVoice, botInVoice);
    await voiceStateUpdate.execute(botInVoice, botMoved);
    await voiceStateUpdate.execute(botMoved, botOutOfVoice);
    assert.equal(logs.voice.sent.length, 0);
    assert.equal(logs.all.sent.length, 0);
    assert.equal(await db.collection("voice_sessions").findOne({ guildId: guild.id, userId: bot.user.id }), null);

    const human = member(false);
    for (const sessionId of ["first-session", "first-session", "second-session"]) {
        const joined = { guild, member: human, channel: voice, sessionId };
        const left = { ...joined, channel: null };
        await Promise.all([voiceStateUpdate.execute(left, joined), voiceStateUpdate.execute(left, joined)]);
        await Promise.all([voiceStateUpdate.execute(joined, left), voiceStateUpdate.execute(joined, left)]);
    }
    const summaries = logs.voice.sent.map(item => item.embeds[0].toJSON());
    assert.deepEqual(summaries.map(log => log.title), [
        "🟢 Voice Channel Joined", "🔴 Voice Channel Left", "🟢 Voice Channel Joined", "🔴 Voice Channel Left",
        "🟢 Voice Channel Joined", "🔴 Voice Channel Left",
    ]);
    for (const log of summaries.filter(item => item.title.includes("Left"))) assert.match(log.description, /Duration\*\*\n\d+s/);
    assert.equal(logs.all.sent.length, 6);
});

test("rapid voice changes use gateway IDs when the member and channels are missing from cache", async () => {
    const { guild } = createGuild();
    const logs = await setupLogging(guild);
    const userId = newId();
    const firstChannelId = newId();
    const secondChannelId = newId();
    const user = { id: userId, bot: false, tag: "Uncached member", displayAvatarURL: () => "https://example.com/avatar.png" };
    const fetched = [];
    guild.client = { users: { async fetch(id) { fetched.push(id); return user; } } };

    const state = { guild, id: userId, channelId: null, sessionId: "repeated-session" };
    function moveTo(channelId) {
        const previous = { ...state };
        state.channelId = channelId;
        return voiceStateUpdate.execute(previous, state);
    }

    const ignored = db.collection("ignored_entities");
    await ignored.insertOne({ guildId: guild.id, id: userId });
    await moveTo(firstChannelId);
    await moveTo(null);
    assert.deepEqual(fetched, []);
    assert.equal(logs.voice.sent.length, 0);
    assert.equal(logs.all.sent.length, 0);
    await ignored.deleteOne({ guildId: guild.id, id: userId });

    await Promise.all([moveTo(firstChannelId), moveTo(secondChannelId), moveTo(null), moveTo(firstChannelId), moveTo(null)]);
    const entries = logs.voice.sent.map(item => item.embeds[0].toJSON());
    assert.deepEqual(entries.map(log => log.title), [
        "🟢 Voice Channel Joined", "🔄 Voice Channel Moved", "🔴 Voice Channel Left",
        "🟢 Voice Channel Joined", "🔴 Voice Channel Left",
    ]);
    assert.ok(entries[0].description.includes(`<@${userId}>`));
    assert.ok(entries[1].description.includes(`<#${firstChannelId}>`));
    assert.ok(entries[1].description.includes(`<#${secondChannelId}>`));
    assert.match(entries[2].description, /Duration\*\*\n\d+s/);
    assert.equal(logs.all.sent.length, 5);
    assert.equal(await db.collection("voice_sessions").findOne({ guildId: guild.id, userId }), null);
});

test("voice logs still reach all-logs if the dedicated destination rejects a send", async t => {
    const { guild, addChannel } = createGuild();
    const logs = await setupLogging(guild);
    t.mock.method(console, "error", () => {});
    t.mock.method(logs.voice, "send", async () => { throw new Error("Missing access"); });
    const user = { id: newId(), bot: false, tag: "Member", displayAvatarURL: () => "https://example.com/avatar.png" };
    const left = { guild, member: { user }, channelId: null, sessionId: "session" };
    const joined = { ...left, channelId: addChannel("voice", { type: ChannelType.GuildVoice }).id };

    await voiceStateUpdate.execute(left, joined);
    await voiceStateUpdate.execute(joined, left);

    assert.deepEqual(logs.all.sent.map(item => item.embeds[0].toJSON().title), [
        "🟢 Voice Channel Joined", "🔴 Voice Channel Left",
    ]);
    assert.equal(console.error.mock.callCount(), 2);
});

test("logging rechecks a destination if its permissions change during an audit lookup", async () => {
    const { guild, addChannel } = createGuild();
    const channels = await setupLogging(guild);
    const source = addChannel("chat");
    guild.fetchAuditLogs = async () => {
        channels.messages.everyonePermissions = new PermissionsBitField(VIEW);
        return { entries: new Collection() };
    };

    const messages = new Collection([[newId(), { author: { id: newId() } }]]);
    await bulkDelete.execute(messages, source);
    assert.equal(channels.messages.sent.length, 0);
    assert.equal(channels.all.sent.length, 1);
});

test("ignore list renders 15 entries and reaches records on the second page", async () => {
    const { guild } = createGuild();
    const ids = Array.from({ length: 16 }, newId);
    for (const id of [...ids].reverse()) {
        await db.collection("ignored_entities").insertOne({
            guildId: guild.id, id, type: "user", createdAt: new Date(0),
        });
    }
    const readPage = page => executeAdminCommand(ignore, guild, {
        options: { getSubcommand: () => "list", getInteger: () => page },
        client: { users: { fetch: async () => ({ username: "Member" }) } },
    });
    const first = (await readPage(null)).embeds[0].toJSON();
    assert.equal(first.fields.length, 15);
    assert.match(first.footer.text, /Page 1 of 2/);
    const second = (await readPage(2)).embeds[0].toJSON();
    assert.equal(second.fields.length, 1);
    assert.match(second.fields[0].value, new RegExp(ids[15]));
    assert.match(second.footer.text, /Page 2 of 2/);
    assert.equal(await readPage(3), "Choose a page from 1 to 2.");
});

test("readiness requires Discord and MongoDB, while liveness reports the HTTP process", async () => {
    let discordReady = false;
    let pingCount = 0;
    db.command = async (command, options) => {
        assert.deepEqual(command, { ping: 1 });
        assert.equal(options.timeoutMS, 1000);
        pingCount += 1;
    };
    const client = { isReady: () => discordReady };
    const handler = createHealthHandler(client);

    async function call(path, serve = handler) {
        let code;
        const response = {
            writeHead(status) { code = status; },
            end(body) { return { code, body: JSON.parse(body) }; },
        };
        return serve({ url: path, headers: {} }, response);
    }

    assert.equal((await call("/health")).code, 200);
    assert.equal((await call("/ready")).code, 503);
    assert.equal(pingCount, 0);
    discordReady = true;
    const [first, second] = await Promise.all([call("/ready"), call("/ready/")]);
    assert.equal(first.code, 200);
    assert.equal(second.body.database, "connected");
    assert.equal(pingCount, 1);

    let audio = "starting";
    const embedded = createHealthHandler(client, "all", { audioStatus: () => audio, waitForInitialAudio: true });
    assert.equal((await call("/health", embedded)).code, 200);
    const starting = await call("/ready", embedded);
    assert.equal(starting.code, 503);
    assert.equal(starting.body.audio, "starting");
    audio = "connected";
    const connected = await call("/ready", embedded);
    assert.equal(connected.code, 200);
    assert.equal(connected.body.audio, "connected");
    audio = "offline";
    const restarting = await call("/ready", embedded);
    assert.equal(restarting.code, 200);
    assert.equal(restarting.body.audio, "offline");

    db.command = async () => { throw new Error("Database connection lost"); };
    const unavailable = await call("/ready", createHealthHandler(client));
    assert.equal(unavailable.code, 503);
    assert.equal(unavailable.body.database, "unavailable");
});
