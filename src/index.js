
require("dotenv").config({ quiet: true });

const http = require("http");
const { terminal, usesRenderLogs } = require("./utils/terminal");
const { bridgeConsole, log, safeText } = require("./utils/runtimeLog");
const { getInstanceRole, handlesCommand } = require("./utils/instanceRole");

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
const renderLogs = usesRenderLogs();
let instanceRole;
try {
    instanceRole = getInstanceRole();
} catch (error) {
    log("ERROR", "Startup", error);
    process.exit(1);
}
bridgeConsole();
terminal.begin(instanceRole);

const missingSettings = ["DISCORD_TOKEN", "MONGODB_URI"].filter(name => !process.env[name]?.trim());
if (missingSettings.length) {
    terminal.abort();
    log("ERROR", "Startup", `Set ${missingSettings.join(" and ")} in .env.`);
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

function logError(component, label, error) {
    log("ERROR", component, label, error ?? "Unknown error");
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
const handlesMusic = handlesCommand(instanceRole, true);
const handlesGeneral = handlesCommand(instanceRole, false);
const reportsMusicOffline = instanceRole === "general" && !process.env.BAUAA_INSTANCE_ROLE?.trim();
const music = installMusic(client, { enabled: handlesMusic, onNodeReady });
const musicCommandNames = new Set(music.commands.map(command => command.data.name));
const lavalinkMode = !handlesMusic ? "Disabled for this role" :
    process.env.BAUAA_EMBEDDED_LAVALINK === "1" ? "Managed by the host" : "No local JVM to start";
terminal.stage("lavalink", "skipped", lavalinkMode);

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
            logError("Event", `${eventName} ignore check failed`, error);
            return;
        }

        try {
            await handler.execute(...args);
        } catch (error) {
            logError("Event", `${eventName} failed`, error);
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
        logError("Music", "Text command failed", error);
    }
    if (!handlesGeneral) return;
    try {
        await messageCreateEvent.execute(message);
    } catch (error) {
        logError("AI", "Message event failed", error);
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
    const message = error.code === "EADDRINUSE"
        ? `Port ${PORT} is already in use. Stop the other process or change PORT.`
        : `Could not open the HTTP listener. ${safeText(error.message)}`;
    if (!terminal.stage("http", "failed", message)) log("ERROR", "HTTP Server", message);
    void shutdown("HTTP server failed", 1);
});

// ========================================
// 📡 DISCORD CONNECTION MONITOR
// ========================================

client.on("shardDisconnect", (event, shardId) => {
    log("WARNING", "Discord Gateway", `Shard ${shardId} disconnected (${event.code})`, event.reason || "Unknown reason");
});

client.on("shardReconnecting", (shardId) => {
    log("INFO", "Discord Gateway", `Shard ${shardId} reconnecting`);
});

client.on("shardResume", (shardId, replayedEvents) => {
    log("SUCCESS", "Discord Gateway", `Shard ${shardId} resumed with ${replayedEvents} events replayed`);
});

client.on("shardError", (error, shardId) => {
    logError("Discord", `Shard ${shardId} error`, error);
});

client.on("error", (error) => {
    logError("Discord", "Client error", error);
});

client.on("warn", (message) => {
    log("WARNING", "Discord", message);
});

// ========================================
// 🤖 BOT READY
// ========================================

const audioStartupTimeout = 8_000;
let audioTimer;

function completeStartup(audio) {
    if (isShuttingDown) return;
    clearTimeout(audioTimer);
    terminal.complete({
        bot: safeText(client.user.tag || client.user.username, undefined, 80),
        servers: client.guilds.cache.size,
        commands: client.commands.size,
        port: server.address()?.port ?? PORT,
        audio,
    });
}

function onNodeReady(id) {
    if (isShuttingDown) return;
    const first = terminal.stage("audio", "ready", "Authenticated audio session");
    if (first) completeStartup("Connected");
    if (renderLogs) log("SUCCESS", "Music", `Lavalink ${id} connected`);
    else if (!first) log("SUCCESS", "Audio Node", `${id} connected`);
}

function startAudio() {
    if (!handlesMusic) {
        terminal.stage("audio", "skipped", "Disabled for this role");
        completeStartup("Disabled");
        return;
    }
    if (!music.manager) {
        terminal.stage("audio", "warning", "No audio node configured. Check LAVALINK_URL and LAVALINK_PASSWORD.");
        completeStartup("Unconfigured");
        return;
    }

    terminal.stage("audio", "working", renderLogs ? "Connecting the bot to audio" : "Waiting for the audio session");
    if (!renderLogs) {
        audioTimer = setTimeout(() => {
            if (!terminal.stage("audio", "warning", "Connection continues in background")) return;
            completeStartup("Connecting");
        }, audioStartupTimeout);
        audioTimer.unref();
    }

    void Promise.resolve().then(() => music.start()).catch(error => {
        if (isShuttingDown) return;
        const message = `Could not initialize the audio client. ${safeText(error.message ?? error)}`;
        if (terminal.stage("audio", "failed", message)) completeStartup("Offline");
        else log("ERROR", "Audio Node", message);
    });
}

client.once("clientReady", async () => {
    if (isShuttingDown) return;
    const gatewayStatus = renderLogs
        ? `${safeText(client.user.tag)} online in ${process.uptime().toFixed(1)}s · ${client.guilds.cache.size} servers · ${client.commands.size} loaded commands`
        : "Gateway identified";
    terminal.stage("discord", "ready", gatewayStatus);
    startAudio();
    if (!handlesGeneral) return;
    try {
        const applicationCommands = [
            ...client.commands.values(),
        ].map(command => command.data.toJSON());

        // Register current project commands globally.
        // Commands absent from this collection are removed.

        await client.application.commands.set(applicationCommands);

        if (!isShuttingDown) log(renderLogs ? "SUCCESS" : "DEBUG", "Discord", `Registered ${applicationCommands.length} slash commands`);
    } catch (error) {
        if (!isShuttingDown) logError("Discord", "Slash command registration failed", error);
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

        logError("Music", "Offline reply failed", error);
    }
}

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
            const isMusicComponent =
                interaction.customId?.startsWith("bauaa:music:");

            if (isMusicComponent) {
                if (handlesMusic) {
                    await music.component(interaction).catch(error => logError("Music", "Player control failed", error));
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
        log("DEBUG", "Command", `/${interaction.commandName} by ${interaction.user.tag}`);
        await command.execute(interaction);
    } catch (error) {
        if (error?.code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged) {
            log("WARNING", "Command", `/${interaction.commandName} already acknowledged. Check for another instance.`);
            return;
        }
        logError("Command", `/${interaction.commandName} failed`, error);

        try {
            const content = "❌ An error occurred while executing this command.";
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ content });
            } else {
                await interaction.reply({ content, flags: MessageFlags.Ephemeral });
            }
        } catch (replyError) {
            logError("Command", "Error reply failed", replyError);
        }
    }
});

// ========================================
// 🚨 PROCESS ERROR MONITOR
// ========================================

process.on("unhandledRejection", (reason) => {
    logError("Process", "Unhandled rejection", reason);
});

process.on("uncaughtException", (error) => {
    terminal.abort();
    logError("Process", "Uncaught exception", error);
    process.exit(1);
});

// ========================================
// 🛑 GRACEFUL SHUTDOWN
// ========================================

let isShuttingDown = false;
let closeLocalLavalink;

module.exports.setLocalLavalinkCleanup = cleanup => { closeLocalLavalink = cleanup; };

async function shutdown(reason, exitCode = 0) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    clearTimeout(audioTimer);
    terminal.beginShutdown(renderLogs ? `${reason} · closing connections` : `Closing services (${reason})`);

    const deadline = setTimeout(() => {
        terminal.finishShutdown(false, "Cleanup exceeded 10s");
        process.exit(1);
    }, 10_000);
    let cleanupFailed = false;
    const onCleanupError = (component, error) => {
        cleanupFailed = true;
        logError(component, "Shutdown failed", error);
    };
    const httpClosed = new Promise(resolve => server.close(resolve));
    await Promise.resolve().then(() => music.close()).catch(error => onCleanupError("Audio Node", error));
    await client.destroy().catch(error => onCleanupError("Discord Gateway", error));
    await Promise.all([
        httpClosed,
        closeDatabase().catch(error => onCleanupError("MongoDB", error)),
        closeLocalLavalink?.().catch(error => onCleanupError("Lavalink", error)),
    ]);

    clearTimeout(deadline);
    terminal.finishShutdown(!cleanupFailed, cleanupFailed ? "Stopped with cleanup errors" : renderLogs ? "Cleanup finished" : "Services closed");
    process.exit(exitCode || Number(cleanupFailed));
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ========================================
// 🔐 DISCORD LOGIN
// ========================================

async function startBot() {
    let stage = "mongodb";
    try {
        terminal.stage(stage, "working", "Connecting and checking indexes");
        const database = await connectDatabase();
        if (isShuttingDown) return;
        terminal.stage(stage, "ready", renderLogs ? `Connected to ${safeText(database.databaseName)}` : "Connection and indexes verified");

        stage = "discord";
        terminal.stage(stage, "working", "Connecting to the gateway");
        await client.login(process.env.DISCORD_TOKEN);
    } catch (error) {
        if (isShuttingDown) return;
        const message = `Startup failed. ${safeText(error.message ?? error)}`;
        if (!terminal.stage(stage, "failed", message)) log("ERROR", "Startup", message);
        await shutdown("Startup failed", 1);
    }
}

terminal.stage("http", "working", "Opening the HTTP listener");
server.listen(PORT, "0.0.0.0", () => {
    const port = server.address().port;
    terminal.stage("http", "ready", renderLogs ? `Port ${port} · /health · /ready` : `Listening on port ${port}`);
    void startBot();
});
