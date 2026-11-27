
require("dotenv").config({ quiet: true });

const http = require("http");

const {
    Client,
    GatewayIntentBits,
    Collection,
    MessageFlags,
    Partials,
    RESTJSONErrorCodes,
} = require("discord.js");

// ========================================
// ⚙️ CONFIGURATION
// ========================================

const PORT = Number(process.env.PORT) || 10000;

if (!process.env.DISCORD_TOKEN) {
    console.error("[Startup] DISCORD_TOKEN is missing");
    process.exit(1);
}

// ========================================
// 📦 COMMAND IMPORTS
// ========================================

// Existing commands
const setupLogsCommand = require("./commands/setupLogs");
const logsStatusCommand = require("./commands/logsStatus");
const ignoreCommand = require("./commands/ignore");
const gameCommand = require("./commands/game");
const { installMusic } = require("./music/commands");

// AI commands
const aiSetupCommand = require("./commands/aiSetup");
const aiAddChannelCommand = require("./commands/aiAddChannel");
const aiRemoveChannelCommand = require("./commands/aiRemoveChannel");
const aiListChannelsCommand = require("./commands/aiListChannels");
const aiDisableCommand = require("./commands/aiDisable");
const aiEnableCommand = require("./commands/aiEnable");
const aiStatusCommand = require("./commands/aiStatus");
const aiMoodCommand = require("./commands/aiMood");
const aiResetCommand = require("./commands/aiReset");
const aiMemoryCommand = require("./commands/aiMemory");
const aiInstructionsCommand = require("./commands/aiInstructions");

// Database and utilities
const {
    connectDatabase,
    closeDatabase,
} = require("./config/database");

const { shouldSkipIgnoredEvent } = require("./utils/ignoreManager");
const { createHealthHandler } = require("./utils/health");
const { getInstanceRole, handlesCommand } = require("./utils/instanceRole");
const { redactPrivateData, sanitizeSingleLine } = require("./ai/contentFilters");

function logError(label, error) {
    const description = sanitizeSingleLine(redactPrivateData(error?.message ?? error), 180);
    const code = error?.code ? ` (${error.code})` : "";
    console.error(`${label}${code} · ${description || "Unknown error"}`);
}

// ========================================
// 📡 EVENT IMPORTS
// ========================================

// Existing logging events
const events = {
    messageDelete: require("./events/messageDelete"),
    messageDeleteBulk: require("./events/messageDeleteBulk"),
    messageUpdate: require("./events/messageUpdate"),

    guildMemberAdd: require("./events/guildMemberAdd"),
    guildMemberRemove: require("./events/guildMemberRemove"),
    guildMemberUpdate: require("./events/guildMemberUpdate"),

    guildBanAdd: require("./events/guildBanAdd"),
    guildBanRemove: require("./events/guildBanRemove"),

    channelCreate: require("./events/channelCreate"),
    channelDelete: require("./events/channelDelete"),
    channelUpdate: require("./events/channelUpdate"),

    roleCreate: require("./events/roleCreate"),
    roleDelete: require("./events/roleDelete"),
    roleUpdate: require("./events/roleUpdate"),

    voiceStateUpdate: require("./events/voiceStateUpdate"),
};

// Existing messageCreate file with AI integration
const messageCreateEvent = require("./events/messageCreate");

// ========================================
// 🤖 DISCORD CLIENT
// ========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],

    partials: [
        Partials.Message,
    ],
});

// ========================================
// 📋 COMMAND COLLECTION
// ========================================

client.commands = new Collection();
const instanceRole = getInstanceRole();
const handlesMusic = handlesCommand(instanceRole, true);
const handlesGeneral = handlesCommand(instanceRole, false);
const reportsMusicOffline = instanceRole === "general" && !process.env.BAUAA_INSTANCE_ROLE?.trim();
const music = installMusic(client, { enabled: handlesMusic });
const musicCommandNames = new Set(music.commands.map(command => command.data.name));
console.log(`BauaaCore instance role: ${instanceRole}`);

const commands = [
    // Existing commands
    setupLogsCommand,
    logsStatusCommand,
    ignoreCommand,
    gameCommand,
    ...music.commands,

    // AI commands
    aiSetupCommand,
    aiAddChannelCommand,
    aiRemoveChannelCommand,
    aiListChannelsCommand,
    aiDisableCommand,
    aiEnableCommand,
    aiStatusCommand,
    aiMoodCommand,
    aiResetCommand,
    aiMemoryCommand,
    aiInstructionsCommand,
];

for (const command of commands) {
    if (!command?.data?.name || typeof command.execute !== "function") {
        throw new Error("❌ Invalid slash command module detected.");
    }

    if (client.commands.has(command.data.name)) {
        throw new Error(`❌ Duplicate command name: ${command.data.name}`);
    }

    client.commands.set(command.data.name, command);
}

// ========================================
// 🔄 GENERIC EVENT REGISTRATION
// ========================================

function registerEvent(eventName, handler) {
    if (!handlesGeneral) return;
    client.on(eventName, async (...args) => {
        try {
            // Voice logging must snapshot the cached states before any asynchronous filtering.
            if (eventName !== events.voiceStateUpdate.name && await shouldSkipIgnoredEvent(eventName, args)) {
                return;
            }
        } catch (error) {
            logError(`[Event] ${eventName} ignore check failed`, error);
            return;
        }

        try {
            await handler.execute(...args);
        } catch (error) {
            logError(`[Event] ${eventName} failed`, error);
        }
    });
}

// ========================================
// 💬 MESSAGE LOGGING EVENTS
// ========================================

registerEvent(
    "messageDelete",
    events.messageDelete
);

registerEvent(
    "messageDeleteBulk",
    events.messageDeleteBulk
);

registerEvent(
    "messageUpdate",
    events.messageUpdate
);

// ========================================
// 🧠 AI MESSAGE EVENT
// ========================================

// AI handler is registered separately.
// Do not register it through the logging filter.

client.on("messageCreate", async (message) => {
    try {
        if (await music.message(message)) return;
    } catch (error) {
        logError("[Music] Text command failed", error);
    }
    if (!handlesGeneral) return;
    try {
        await messageCreateEvent.execute(message);
    } catch (error) {
        logError("[AI] Message event failed", error);
    }
});

// ========================================
// 👥 MEMBER LOGGING EVENTS
// ========================================

registerEvent(
    "guildMemberAdd",
    events.guildMemberAdd
);

registerEvent(
    "guildMemberRemove",
    events.guildMemberRemove
);

registerEvent(
    "guildMemberUpdate",
    events.guildMemberUpdate
);

// ========================================
// 🔨 BAN / UNBAN LOGGING EVENTS
// ========================================

registerEvent(
    "guildBanAdd",
    events.guildBanAdd
);

registerEvent(
    "guildBanRemove",
    events.guildBanRemove
);

// ========================================
// 📝 CHANNEL LOGGING EVENTS
// ========================================

registerEvent(
    "channelCreate",
    events.channelCreate
);

registerEvent(
    "channelDelete",
    events.channelDelete
);

registerEvent(
    "channelUpdate",
    events.channelUpdate
);

// ========================================
// 🎭 ROLE LOGGING EVENTS
// ========================================

registerEvent(
    "roleCreate",
    events.roleCreate
);

registerEvent(
    "roleDelete",
    events.roleDelete
);

registerEvent(
    "roleUpdate",
    events.roleUpdate
);

// ========================================
// 🔊 VOICE LOGGING EVENTS
// ========================================

registerEvent(
    "voiceStateUpdate",
    events.voiceStateUpdate
);

// ========================================
// 🌐 HTTP HEALTH SERVER
// ========================================

const health = createHealthHandler(client, instanceRole, {
    audioStatus: music.audioStatus,
    waitForInitialAudio: process.env.BAUAA_EMBEDDED_LAVALINK === "1",
});
const server = http.createServer((req, res) => {
    if (!music.handleHttp(req, res)) health(req, res);
});

// ========================================
// 🚨 HTTP SERVER ERROR HANDLING
// ========================================

server.on("error", (error) => {
    logError("[HTTP] Server error", error);
    process.exit(1);
});

// ========================================
// 🚀 START HTTP SERVER
// ========================================

server.listen(PORT, "0.0.0.0", () => {
    console.log(`[HTTP] Port ${PORT} · /health · /ready`);
});

// ========================================
// 📡 DISCORD CONNECTION MONITOR
// ========================================

client.on("shardDisconnect", (event, shardId) => {
    const reason = sanitizeSingleLine(redactPrivateData(event.reason || "Unknown reason"), 120);
    console.warn(`[Discord] Shard ${shardId} disconnected (${event.code}) · ${reason}`);
});

client.on("shardReconnecting", (shardId) => {
    console.log(`[Discord] Shard ${shardId} reconnecting`);
});

client.on("shardResume", (shardId, replayedEvents) => {
    console.log(`[Discord] Shard ${shardId} resumed · ${replayedEvents} events replayed`);
});

client.on("shardError", (error, shardId) => {
    logError(`[Discord] Shard ${shardId} error`, error);
});

client.on("error", (error) => {
    logError("[Discord] Client error", error);
});

client.on("warn", (message) => {
    console.warn(`[Discord] ${sanitizeSingleLine(redactPrivateData(message), 180)}`);
});

// ========================================
// 🤖 BOT READY
// ========================================

client.once("clientReady", async () => {
    void Promise.resolve(music.start()).catch(error => logError("[Music] Node startup failed", error));
    console.log(`[Discord] ${client.user.tag} online · ${client.guilds.cache.size} servers · ${client.commands.size} commands`);

    if (!handlesGeneral) return;
    try {
        const applicationCommands = [
            ...client.commands.values(),
        ].map(command => command.data.toJSON());

        // Register current project commands globally.
        // Commands absent from this collection are removed.

        await client.application.commands.set(applicationCommands);

        console.log(`[Discord] Registered ${applicationCommands.length} slash commands`);
    } catch (error) {
        logError("[Discord] Slash command registration failed", error);
    }
});

// ========================================
// ⚡ SLASH COMMAND HANDLER
// ========================================

async function musicOfflineFallback(interaction) {
    // Give the music instance time to acknowledge.
    await new Promise(resolve => setTimeout(resolve, 1500));

    try {
        await interaction.reply({
            content:
                "🔴 **Music Service Unavailable**\n" +
                "The music service is currently offline or not responding. " +
                "Please try again later.",
            flags: 64,
        });
    } catch (error) {
        // The music instance may have already responded.
        if ([40060, 10062].includes(error?.code)) return;

        logError("[Music] Offline reply failed", error);
    }
}

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
            const isMusicComponent =
                interaction.customId?.startsWith("bauaa:music:");

            if (isMusicComponent) {
                if (handlesMusic) {
                    await music.component(interaction).catch(error => logError("[Music] Player control failed", error));
                } else if (reportsMusicOffline) {
                    await musicOfflineFallback(interaction);
                }
            }
        }
        return;
    }

    const command = client.commands.get(interaction.commandName);
    const isMusicCommand = musicCommandNames.has(interaction.commandName);

    if (!command || !handlesCommand(instanceRole, isMusicCommand)) {
        if (reportsMusicOffline && isMusicCommand) await musicOfflineFallback(interaction);
        return;
    }

    try {
        console.log(`[Command] /${interaction.commandName} · ${sanitizeSingleLine(interaction.user.tag, 80)}`);
        await command.execute(interaction);
    } catch (error) {
        if (error?.code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged) {
            console.warn(`[Command] /${interaction.commandName} already acknowledged · check for another instance`);
            return;
        }
        logError(`[Command] /${interaction.commandName} failed`, error);

        try {
            const content = "❌ An error occurred while executing this command.";
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ content });
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral });
            }
        } catch (replyError) {
            logError("[Command] Error reply failed", replyError);
        }
    }
});

// ========================================
// 🚨 PROCESS ERROR MONITOR
// ========================================

process.on("unhandledRejection", (reason) => {
    logError("[Process] Unhandled rejection", reason);
});

process.on("uncaughtException", (error) => {
    logError("[Process] Uncaught exception", error);
    process.exit(1);
});

// ========================================
// 🛑 GRACEFUL SHUTDOWN
// ========================================

let isShuttingDown = false;

async function shutdown(signal) {
    if (isShuttingDown) {
        return;
    }

    isShuttingDown = true;

    console.log(`[Shutdown] ${signal} · closing connections`);

    await music.close()?.catch(error => logError("[Music] Shutdown failed", error));

    // Disconnect Discord
    client.destroy();

    // Close MongoDB
    await closeDatabase().catch((error) => {
        logError("[MongoDB] Shutdown failed", error);
    });

    // Close HTTP server
    if (server.listening) {
        await new Promise((resolve) => {
            server.close(resolve);
        });
    }

    console.log("[Shutdown] Complete");

    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ========================================
// 🔐 DISCORD LOGIN
// ========================================

async function startBot() {
    try {
        await connectDatabase();
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        logError("[Startup] Failed", error);

        await closeDatabase().catch(() => {});

        if (server.listening) {
            server.close();
        }

        process.exit(1);
    }
}

startBot();
