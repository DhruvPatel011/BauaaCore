
require("dotenv").config();

const http = require("http");

const {
    Client,
    GatewayIntentBits,
    Collection,
    Partials,
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
const ignoreCommand = require("./commands/ignore");

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

// Database and utilities
const {
    connectDatabase,
    closeDatabase,
} = require("./config/database");

const { isIgnored } = require("./utils/ignoreManager");

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

const commands = [
    // Existing commands
    setupLogsCommand,
    ignoreCommand,

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
// 🛡️ IGNORE MANAGER EVENT FILTER
// ========================================

async function shouldSkipIgnoredEvent(eventName, args) {
    const candidates = new Set();

    const add = (value) => {
        if (
            typeof value === "string" &&
            /^\d{17,20}$/.test(value)
        ) {
            candidates.add(value);
        }
    };

    const addMessage = (message) => {
        if (!message) return;

        add(message.webhookId);
        add(message.author?.id);
        add(message.user?.id);
        add(message.member?.id);
    };

    const first = args[0];

    if (
        eventName === "messageDelete" ||
        eventName === "messageUpdate"
    ) {
        addMessage(eventName === "messageUpdate" ? args[1] : first);
        addMessage(first);

    } else if (eventName === "messageDeleteBulk") {
        for (const message of first?.values?.() || []) {
            addMessage(message);
        }

    } else if (eventName.startsWith("guildMember")) {
        add(first?.id);
        add(first?.user?.id);

    } else if (eventName.startsWith("guildBan")) {
        add(first?.user?.id);

    } else if (eventName === "voiceStateUpdate") {
        add(args[0]?.id);
        add(args[0]?.member?.id);
        add(args[0]?.member?.user?.id);

        add(args[1]?.id);
        add(args[1]?.member?.id);
        add(args[1]?.member?.user?.id);
    }

    const guild =
        first?.guild ||
        first?.member?.guild ||
        args[1]?.guild ||
        args[1]?.member?.guild;

    if (!guild || candidates.size === 0) {
        return false;
    }

    for (const id of candidates) {
        if (await isIgnored(guild.id, id)) {
            console.log(`⏭️ Ignored ${eventName} log for ID ${id}`);
            return true;
        }
    }

    return false;
}

// ========================================
// 🔄 GENERIC EVENT REGISTRATION
// ========================================

function registerEvent(eventName, handler, logger = null) {
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

const server = http.createServer((req, res) => {
    let pathname;

    try {
        pathname = new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
        ).pathname;

        // Remove trailing slashes safely
        pathname = pathname.replace(/\/+$/, "") || "/";

    } catch (error) {
        res.writeHead(400, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        });

        return res.end(JSON.stringify({
            error: "Bad Request",
        }));
    }

    // ❤️ Main health endpoint
    if (pathname === "/" || pathname === "/health") {
        const discordConnected = client.isReady();

        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        });

        return res.end(JSON.stringify({
            service: "BauaaCore",
            status: "running",
            discord: discordConnected ? "connected" : "disconnected",
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
        }));
    }

    // 🟢 Readiness endpoint
    if (pathname === "/ready") {
        const discordConnected = client.isReady();

        res.writeHead(
            discordConnected ? 200 : 503,
            {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store",
            }
        );

        return res.end(JSON.stringify({
            service: "BauaaCore",
            status: discordConnected ? "ready" : "not_ready",
            discord: discordConnected ? "connected" : "disconnected",
            timestamp: new Date().toISOString(),
        }));
    }

    // ❓ Unknown routes
    res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });

    return res.end(JSON.stringify({
        error: "Not Found",
        path: pathname,
    }));
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
        return;
    }

    const command = client.commands.get(
        interaction.commandName
    );

    if (!command) {
        return;
    }

    try {
        console.log(
            `⚡ Command Executed: /${interaction.commandName} | User: ${interaction.user.tag}`
        );

        await command.execute(interaction);

    } catch (error) {
        console.error(
            `❌ Command Execution Error: /${interaction.commandName}`,
            error
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
                replyError
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
