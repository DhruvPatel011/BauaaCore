
require("dotenv").config();

const http = require("http");

const {
    Client,
    GatewayIntentBits,
    Collection,
    Partials,
    RESTJSONErrorCodes,
} = require("discord.js");

// ========================================
// ⚙️ CONFIGURATION
// ========================================

const PORT = Number(process.env.PORT) || 10000;

if (!process.env.DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN is missing from .env!");
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

console.log(`📦 Loaded ${client.commands.size} Slash Commands Successfully!`);

// ========================================
// 🔄 GENERIC EVENT REGISTRATION
// ========================================

function registerEvent(eventName, handler, logger = null) {
    if (!handlesGeneral) return;
    client.on(eventName, async (...args) => {
        try {
            if (await shouldSkipIgnoredEvent(eventName, args)) {
                return;
            }
        } catch (error) {
            console.error(
                `⚠️ Ignore check failed for ${eventName}:`,
                error
            );
            return;
        }

        if (logger) {
            try {
                logger(...args);
            } catch (error) {
                console.error(
                    `❌ ${eventName} Console Logger Error:`,
                    error
                );
            }
        }

        try {
            await handler.execute(...args);
        } catch (error) {
            console.error(
                `❌ ${eventName} Event Error:`,
                error
            );
        }
    });
}

// ========================================
// 💬 MESSAGE LOGGING EVENTS
// ========================================

registerEvent(
    "messageDelete",
    events.messageDelete,
    () => console.log("🗑️ MESSAGE DELETE EVENT RECEIVED")
);

registerEvent(
    "messageDeleteBulk",
    events.messageDeleteBulk,
    (messages) => {
        console.log(
            `🗑️ BULK DELETE EVENT RECEIVED | ${messages.size} messages`
        );
    }
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
        console.warn("Music text command failed:", error?.code || error?.name);
    }
    if (!handlesGeneral) return;
    try {
        await messageCreateEvent.execute(message);
    } catch (error) {
        console.error("❌ AI Message Event Error:", error);
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
    events.guildBanAdd,
    (ban) => {
        console.log(
            "🔨 BAN EVENT RECEIVED:",
            ban.user?.tag || "Unknown user"
        );
    }
);

registerEvent(
    "guildBanRemove",
    events.guildBanRemove,
    (ban) => {
        console.log(
            "🔓 UNBAN EVENT RECEIVED:",
            ban.user?.tag || "Unknown user"
        );
    }
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

const health = createHealthHandler(client, instanceRole);
const server = http.createServer((req, res) => {
    if (!music.handleHttp(req, res)) health(req, res);
});

// ========================================
// 🚨 HTTP SERVER ERROR HANDLING
// ========================================

server.on("error", (error) => {
    console.error("❌ HTTP SERVER ERROR:", error);
    process.exit(1);
});

// ========================================
// 🚀 START HTTP SERVER
// ========================================

server.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log("╔══════════════════════════════════════╗");
    console.log("║       🚀 BAUAACORE HTTP SERVER       ║");
    console.log("╠══════════════════════════════════════╣");
    console.log(`║  🌐 Port       : ${PORT}`);
    console.log("║  ❤️ Health     : /health");
    console.log("║  🟢 Readiness  : /ready");
    console.log("║  ⚡ Status     : RUNNING");
    console.log("╚══════════════════════════════════════╝");
    console.log("");
});

// ========================================
// 📡 DISCORD CONNECTION MONITOR
// ========================================

client.on("shardDisconnect", (event, shardId) => {
    console.error(
        `🔴 Discord Gateway disconnected | Shard: ${shardId} | Code: ${event.code} | Reason: ${event.reason || "Unknown"}`
    );
});

client.on("shardReconnecting", (shardId) => {
    console.log(
        `🟡 Discord Gateway reconnecting | Shard: ${shardId}`
    );
});

client.on("shardResume", (shardId, replayedEvents) => {
    console.log(
        `🟢 Discord Gateway resumed | Shard: ${shardId} | Replayed: ${replayedEvents}`
    );
});

client.on("shardError", (error, shardId) => {
    console.error(
        `❌ Discord Shard Error | Shard: ${shardId}`,
        error
    );
});

client.on("error", (error) => {
    console.error("❌ Discord Client Error:", error);
});

client.on("warn", (message) => {
    console.warn("⚠️ Discord Warning:", message);
});

// ========================================
// 🤖 BOT READY
// ========================================

client.once("clientReady", async () => {
    void Promise.resolve(music.start()).catch(error => console.warn("Music node startup failed:", error?.code || error?.name));
    console.log("");
    console.log("╔══════════════════════════════════════╗");
    console.log("║          🤖 BAUAACORE BOT            ║");
    console.log("╠══════════════════════════════════════╣");
    console.log(`║  👤 Bot Name  : ${client.user.tag}`);
    console.log(`║  🆔 Bot ID    : ${client.user.id}`);
    console.log(`║  🌍 Servers   : ${client.guilds.cache.size}`);
    console.log(`║  📦 Commands  : ${client.commands.size}`);
    console.log("║  🟢 Status    : ONLINE");
    console.log("╚══════════════════════════════════════╝");
    console.log("");

    if (!handlesGeneral) return;
    try {
        const applicationCommands = [
            ...client.commands.values(),
        ].map(command => command.data.toJSON());

        // Register current project commands globally.
        // Commands absent from this collection are removed.

        await client.application.commands.set(applicationCommands);

        console.log(
            `🎉 Successfully Registered ${applicationCommands.length} Global Slash Commands!`
        );

    } catch (error) {
        console.error(
            "❌ Failed to Register Global Slash Commands:",
            error
        );
    }
});

// ========================================
// ⚡ SLASH COMMAND HANDLER
// ========================================

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
        if (handlesMusic && (interaction.isButton() || interaction.isStringSelectMenu())) {
            await music.component(interaction).catch(error => console.warn("Music interaction failed:", error?.code || error?.name));
        }
        return;
    }

    const command = client.commands.get(
        interaction.commandName
    );

    if (!command || !handlesCommand(instanceRole, musicCommandNames.has(interaction.commandName))) {
        return;
    }

    try {
        console.log(
            `⚡ Command Executed: /${interaction.commandName} | User: ${interaction.user.tag}`
        );

        await command.execute(interaction);

    } catch (error) {
        if (error?.code === RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged) {
            console.warn(`Interaction already acknowledged: /${interaction.commandName}. Check for another BauaaCore instance using this bot token.`);
            return;
        }
        console.error(
            `❌ Command Execution Error: /${interaction.commandName}`,
            error?.code || error?.name
        );

        try {
            const reply = {
                content: "❌ An error occurred while executing this command.",
                ephemeral: true,
            };

            if (interaction.replied || interaction.deferred) {
                await interaction.editReply(reply);
            } else {
                await interaction.reply(reply);
            }

        } catch (replyError) {
            console.error(
                "❌ Interaction Reply Error:",
                replyError?.code || replyError?.name
            );
        }
    }
});

// ========================================
// 🚨 PROCESS ERROR MONITOR
// ========================================

process.on("unhandledRejection", (reason) => {
    console.error(
        "🚨 Unhandled Promise Rejection:",
        reason
    );
});

process.on("uncaughtException", (error) => {
    console.error(
        "🚨 Uncaught Exception:",
        error
    );

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

    console.log("");
    console.log("╔══════════════════════════════════════╗");
    console.log("║        🛑 BAUAACORE SHUTDOWN         ║");
    console.log("╠══════════════════════════════════════╣");
    console.log(`║  📡 Signal : ${signal}`);
    console.log("║  🔄 Closing connections...");
    console.log("╚══════════════════════════════════════╝");

    await music.close()?.catch(error => console.warn("Music shutdown failed:", error?.code || error?.name));

    // Disconnect Discord
    client.destroy();

    // Close MongoDB
    await closeDatabase().catch((error) => {
        console.error("❌ MongoDB Shutdown Error:", error);
    });

    // Close HTTP server
    if (server.listening) {
        await new Promise((resolve) => {
            server.close(resolve);
        });
    }

    console.log("✅ BauaaCore Shutdown Completed.");

    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ========================================
// 🔐 DISCORD LOGIN
// ========================================

console.log("");
console.log("╔══════════════════════════════════════╗");
console.log("║       🚀 STARTING BAUAACORE          ║");
console.log("╚══════════════════════════════════════╝");
console.log("");

async function startBot() {
    try {
        console.log("🍃 Connecting to MongoDB...");

        await connectDatabase();

        console.log("🔐 Connecting to Discord Gateway...");

        await client.login(process.env.DISCORD_TOKEN);

        console.log("✅ Discord Authentication Successful!");

    } catch (error) {
        console.error("❌ Startup Failed:", error);

        await closeDatabase().catch(() => {});

        if (server.listening) {
            server.close();
        }

        process.exit(1);
    }
}

startBot();
