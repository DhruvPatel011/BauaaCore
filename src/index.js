
require("dotenv").config();

const http = require("node:http");
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

// Existing logging events
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
    console.error("[Startup] DISCORD_TOKEN is missing.");
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

// Register commands
client.commands = new Collection();

client.commands.set(
    setupLogsCommand.data.name,
    setupLogsCommand
);

for (const command of musicCommands.commands) {
    client.commands.set(command.data.name, command);
}

// Existing logging event registration
function registerEvent(eventName, handler) {
    client.on(eventName, async (...args) => {
        try {
            await handler.execute(...args);
        } catch (error) {
            console.error(
                `[Logs] ${eventName}: ${error.message || error}`
            );
        }
    });
}

registerEvent("messageDelete", messageDelete);
registerEvent("messageDeleteBulk", messageDeleteBulk);
registerEvent("messageUpdate", messageUpdate);

registerEvent("guildMemberAdd", guildMemberAdd);
registerEvent("guildMemberRemove", guildMemberRemove);
registerEvent("guildMemberUpdate", guildMemberUpdate);

registerEvent("guildBanAdd", guildBanAdd);
registerEvent("guildBanRemove", guildBanRemove);

registerEvent("channelCreate", channelCreate);
registerEvent("channelDelete", channelDelete);
registerEvent("channelUpdate", channelUpdate);

registerEvent("roleCreate", roleCreate);
registerEvent("roleDelete", roleDelete);
registerEvent("roleUpdate", roleUpdate);

registerEvent("voiceStateUpdate", voiceStateUpdate);

// HTTP health server
const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/health") {
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        });

        return res.end(JSON.stringify({
            service: "BauaaCore",
            status: "running",
            discord: client.isReady() ? "connected" : "connecting",
            music: client.music ? "enabled" : "starting",
            uptime: Math.floor(process.uptime()),
        }));
    }

    res.writeHead(404, {
        "Content-Type": "application/json",
    });

    res.end(JSON.stringify({
        error: "Not Found",
    }));
});

server.on("error", error => {
    console.error("[HTTP]", error.message);
    process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`[HTTP] Server listening on port ${PORT}`);
});

// Discord connection events
client.on("shardDisconnect", (event, shardId) => {
    console.warn(
        `[Discord] Shard ${shardId} disconnected (${event.code}).`
    );
});

client.on("shardReconnecting", shardId => {
    console.log(`[Discord] Reconnecting shard ${shardId}...`);
});

client.on("shardResume", shardId => {
    console.log(`[Discord] Shard ${shardId} resumed.`);
});

client.on("shardError", error => {
    console.error("[Discord] Gateway error:", error.message);
});

client.on("error", error => {
    console.error("[Discord] Client error:", error.message);
});

// Bot ready
client.once("clientReady", async () => {
    console.log("--------------------------------");
    console.log(`[Bot] ${client.user.tag} is online.`);
    console.log(`[Bot] Servers: ${client.guilds.cache.size}`);
    console.log("--------------------------------");

    try {
        const payload = [...client.commands.values()].map(command =>
            command.data.toJSON()
        );

        await client.application.commands.set(payload);

        console.log(
            `[Commands] Registered ${payload.length} slash commands.`
        );
    } catch (error) {
        console.error("[Commands] Registration failed:", error.message);
    }
});

// Interactions
client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isButton()) {
            const handled =
                await musicCommands.handleMusicButton(interaction);

            if (handled) return;
        }

        if (!interaction.isChatInputCommand()) return;

        const command = client.commands.get(interaction.commandName);

        if (!command) return;

        await command.execute(interaction);

    } catch (error) {
        console.error("[Interaction]", error.message || error);

        const message =
            error.message === "Join a voice channel first."
                ? "🔊 Join a voice channel first."
                : "❌ Something went wrong. Please try again.";

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({
                    content: message,
                    embeds: [],
                    components: [],
                });
            } else {
                await interaction.reply({
                    content: message,
                    ephemeral: true,
                });
            }
        } catch {
            // Ignore reply errors if Discord interaction expired.
        }
    }
});

// Process errors
process.on("unhandledRejection", reason => {
    const message = reason?.message || String(reason);
    console.error("[Process] Unhandled rejection:", message);
});

process.on("uncaughtException", error => {
    console.error("[Process] Uncaught exception:", error.message);
    process.exit(1);
});

// Graceful shutdown
let isShuttingDown = false;

async function shutdown(signal) {
    if (isShuttingDown) return;

    isShuttingDown = true;

    console.log(`[Shutdown] ${signal} received.`);

    try {
        const players = client.music?.players;

        if (players) {
            for (const player of players.values()) {
                try {
                    await player.destroy();
                } catch {
                    // Continue shutdown.
                }
            }
        }

        client.destroy();

        if (server.listening) {
            await new Promise(resolve => server.close(resolve));
        }

        console.log("[Shutdown] Completed.");

    } catch (error) {
        console.error("[Shutdown]", error.message);
    } finally {
        process.exit(0);
    }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start bot
async function start() {
    ensureStore();

    client.music = createMusicManager(client);

    console.log("[Startup] Starting BauaaCore...");

    await client.login(process.env.DISCORD_TOKEN);
}

start().catch(error => {
    console.error("[Startup] Failed:", error.message);
    process.exit(1);
});
