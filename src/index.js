require("dotenv").config();

const http = require("http");
const {
    Client,
    GatewayIntentBits,
    Collection,
    Partials,
} = require("discord.js");
const setupLogsCommand = require("./commands/setupLogs");

const musicCommands = require("./commands/music");

const { createMusicManager } = require("./music/manager");

const { ensureStore } = require("./music/store");

// Existing logging event handlers (kept intact).
const messageDelete = require("./events/messageDelete");
const messageDeleteBulk = require("./events/messageDeleteBulk");
const messageUpdate = require("./events/messageUpdate");
const guildMemberAdd = require("./events/guildMemberAdd");
const guildMemberRemove = require("./events/guildMemberRemove");
const guildMemberUpdate = require("./events/guildMemberUpdate");
const guildBanAdd = require("./events/guildBanAdd");
const guildBanRemove = require("./events/guildBanRemove");
const channelCreate = require("./events/channelCreate");
const channelDelete = require("./events/channelDelete");
const channelUpdate = require("./events/channelUpdate");
const roleCreate = require("./events/roleCreate");
const roleDelete = require("./events/roleDelete");
const roleUpdate = require("./events/roleUpdate");
const voiceStateUpdate = require("./events/voiceStateUpdate");

const PORT = Number(process.env.PORT) || 10000;
if (!process.env.DISCORD_TOKEN) {
    console.error("DISCORD_TOKEN is missing!");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message],
});

client.commands = new Collection();
client.commands.set(setupLogsCommand.data.name, setupLogsCommand);
for (const command of musicCommands.commands) client.commands.set(command.data.name, command);

function registerEvent(eventName, handler, logger = null) {
    client.on(eventName, async (...args) => {
        if (logger) {
            try { logger(...args); }
            catch (error) { console.error(`❌ ${eventName} log message error:`, error); }
        }
        try { await handler.execute(...args); }
        catch (error) { console.error(`❌ ${eventName} Logger Error:`, error); }
    });
}

registerEvent("messageDelete", messageDelete, () => console.log("🔥 MESSAGE DELETE EVENT RECEIVED"));
registerEvent("messageDeleteBulk", messageDeleteBulk, messages => console.log(`🔥 BULK DELETE EVENT RECEIVED | ${messages.size} messages`));
registerEvent("messageUpdate", messageUpdate);
registerEvent("guildMemberAdd", guildMemberAdd);
registerEvent("guildMemberRemove", guildMemberRemove);
registerEvent("guildMemberUpdate", guildMemberUpdate);
registerEvent("guildBanAdd", guildBanAdd, ban => console.log("🔨 BAN EVENT RECEIVED:", ban.user?.tag || "Unknown user"));
registerEvent("guildBanRemove", guildBanRemove, ban => console.log("🔓 UNBAN EVENT RECEIVED:", ban.user?.tag || "Unknown user"));
registerEvent("channelCreate", channelCreate);
registerEvent("channelDelete", channelDelete);
registerEvent("channelUpdate", channelUpdate);
registerEvent("roleCreate", roleCreate);
registerEvent("roleDelete", roleDelete);
registerEvent("roleUpdate", roleUpdate);
registerEvent("voiceStateUpdate", voiceStateUpdate);

// Keep the original HTTP health endpoint for Render.
const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return res.end(JSON.stringify({
            service: "BauaaCore",
            status: "running",
            discord: client.isReady() ? "connected" : "disconnected",
            lavalink: client.music?.shoukaku?.nodes?.size ? "configured" : "starting",
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
        }));
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
});
server.on("error", error => { console.error("❌ HTTP SERVER ERROR:", error); process.exit(1); });
server.listen(PORT, "0.0.0.0", () => console.log(`🌐 HTTP server running on port ${PORT}`));

client.on("shardDisconnect", (event, shardId) => console.error(`🔴 Discord Gateway disconnected | Shard: ${shardId} | Code: ${event.code} | Reason: ${event.reason || "Unknown"}`));
client.on("shardReconnecting", shardId => console.log(`🟡 Discord Gateway reconnecting | Shard: ${shardId}`));
client.on("shardResume", (shardId, replayedEvents) => console.log(`🟢 Discord Gateway resumed | Shard: ${shardId} | Replayed: ${replayedEvents}`));
client.on("shardError", (error, shardId) => console.error(`❌ Discord Shard Error | Shard: ${shardId}`, error));
client.on("error", error => console.error("❌ Discord Client Error:", error));
client.on("warn", message => console.warn("⚠️ Discord Warning:", message));

client.once("clientReady", async () => {
    console.log("----------------------------------");
    console.log(`✅ ${client.user.tag} is ONLINE!`);
    console.log(`🆔 Bot ID: ${client.user.id}`);
    console.log(`🌐 Servers: ${client.guilds.cache.size}`);
    console.log("----------------------------------");
    try {
        const payload = [...client.commands.values()].map(command => command.data.toJSON());
        await client.application.commands.set(payload);
        console.log(`✅ Registered ${payload.length} global slash commands.`);
    } catch (error) {
        console.error("❌ Failed to register global commands:", error);
    }
});

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isButton()) {
            const handled = await musicCommands.handleMusicButton(interaction);
            if (handled) return;
        }
        if (!interaction.isChatInputCommand()) return;
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        await command.execute(interaction);
    } catch (error) {
        console.error("❌ Interaction Error:", error);
        const message = error.message === "Join a voice channel first."
            ? "🔊 Join a voice channel first."
            : "❌ Something went wrong. Check the bot logs for details.";
        try {
            if (interaction.replied || interaction.deferred) await interaction.editReply({ content: message, embeds: [], components: [] });
            else await interaction.reply({ content: message, ephemeral: true });
        } catch (replyError) { console.error("❌ Interaction reply error:", replyError); }
    }
});

process.on("unhandledRejection", reason => console.error("❌ Unhandled Promise Rejection:", reason));
process.on("uncaughtException", error => { console.error("❌ Uncaught Exception:", error); process.exit(1); });

let isShuttingDown = false;
async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`🛑 ${signal} received. Shutting down BauaaCore...`);
    try {
        for (const player of client.music?.players?.values?.() || []) await player.destroy().catch(() => {});
        client.destroy();
        if (server.listening) await new Promise(resolve => server.close(resolve));
    } finally {
        console.log("✅ BauaaCore shutdown completed.");
        process.exit(0);
    }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

async function start() {
    ensureStore();
    // Connect to the local Lavalink process started by Docker's start.sh.
    client.music = createMusicManager(client);
    console.log("🚀 Starting BauaaCore...");
    await client.login(process.env.DISCORD_TOKEN);
    console.log("🔐 Discord login successful!");
}
start().catch(error => {
    console.error("❌ Startup failed:", error);
    process.exit(1);
});
