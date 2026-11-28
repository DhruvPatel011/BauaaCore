
require("dotenv").config({ quiet: true });

const http = require("http");
const { terminal, usesRenderLogs } = require("./utils/terminal");
const { bridgeConsole, log, safeText } = require("./utils/runtimeLog");
const { getInstanceRole, handlesCommand } = require("./utils/instanceRole");
const { interactionDispatcher, limitInteractionCallbacks } = require("./utils/interactions");

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

const generalCommands = require("./commands");
const { createHelpCommand } = require("./commands/help");
const { installMusic } = require("./music/commands");

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
limitInteractionCallbacks(client.rest);

// ========================================
// 📋 COMMAND COLLECTION
// ========================================

client.commands = new Collection();
const handlesMusic = handlesCommand(instanceRole, true);
const handlesGeneral = handlesCommand(instanceRole, false);
const music = installMusic(client, { enabled: handlesMusic, onNodeReady });
const musicCommandNames = new Set(music.commands.map(command => command.data.name));
const lavalinkMode = !handlesMusic ? "Disabled for this role" :
    process.env.BAUAA_EMBEDDED_LAVALINK === "1" ? "Managed by the host" : "No local JVM to start";
terminal.stage("lavalink", "skipped", lavalinkMode);

const commands = [...generalCommands, ...music.commands];
const helpCommand = createHelpCommand(commands);
commands.push(helpCommand);

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
    isDraining: () => isShuttingDown,
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
    if (!isShuttingDown) log("INFO", "Discord Gateway", `Shard ${shardId} reconnecting`);
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
    const detail = renderLogs ? `Lavalink ${id} connected · authenticated audio session` : "Authenticated audio session";
    const first = terminal.stage("audio", "ready", detail);
    if (first) completeStartup("Connected");
    else log("SUCCESS", "Audio Node", `${id} connected`);
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
    terminal.stage("discord", "ready", "Gateway identified");
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

const dispatch = interactionDispatcher({
    onError(message, error, interaction) {
        const name = interaction.commandName ? `/${interaction.commandName}` : "Component";
        const age = Date.now() - interaction.createdTimestamp;
        log(error ? "ERROR" : "WARNING", "Interaction", `${name}: ${message} (${age} ms after creation, role ${instanceRole})`, error);
    },
    onAcknowledge(interaction) {
        if (interaction.commandName) log("DEBUG", "Command", `/${interaction.commandName} by ${interaction.user.tag}`);
    },
});

client.on("interactionCreate", interaction => {
    if (isShuttingDown) return;
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (command && handlesCommand(instanceRole, musicCommandNames.has(interaction.commandName))) {
            void dispatch(interaction, command.execute.bind(command));
        }
        return;
    }
    if (!interaction.isButton() && !interaction.isStringSelectMenu()) return;
    if (handlesGeneral && helpCommand.matches(interaction.customId)) {
        void dispatch(interaction, helpCommand.component);
    } else if (handlesMusic && interaction.customId?.startsWith("bauaa:music:")) {
        void dispatch(interaction, music.component);
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
    await Promise.resolve().then(() => music.close()).catch(error => onCleanupError("Audio Node", error));
    await Promise.all([
        new Promise(resolve => server.close(resolve)),
        client.destroy().catch(error => onCleanupError("Discord Gateway", error)),
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
