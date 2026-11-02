
require("dotenv").config();

const http = require("http");

const {
    Client,
    GatewayIntentBits,
    Collection,
    Partials,
} = require("discord.js");

// ========================================
// CONFIGURATION
// ========================================

const PORT = Number(process.env.PORT) || 10000;

if (!process.env.DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN is missing!");
    process.exit(1);
}

// ========================================
// COMMANDS
// ========================================

const setupLogsCommand = require("./commands/setupLogs");
const ignoreCommand = require("./commands/ignore");
const {
    connectDatabase,
    closeDatabase,
} = require("./config/database");
const { isIgnored } = require("./utils/ignoreManager");

// ========================================
// LOGGING EVENTS
// ========================================

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

    // Voice channel join/leave logs only.
    voiceStateUpdate: require("./events/voiceStateUpdate"),
};

// ========================================
// DISCORD CLIENT
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
// COMMAND COLLECTION
// ========================================

client.commands = new Collection();

client.commands.set(
    setupLogsCommand.data.name,
    setupLogsCommand
);

client.commands.set(
    ignoreCommand.data.name,
    ignoreCommand
);

// ========================================
// EVENT REGISTRATION
// ========================================

// Check IDs associated with an event before allowing any log handler to run.
// This prevents ignored users, bots and webhooks from reaching both detailed
// log channels and the all-logs summary.
async function shouldSkipIgnoredEvent(eventName, args) {
    const candidates = new Set();

    const add = (value) => {
        if (typeof value === "string" && /^\\d{17,20}$/.test(value)) {
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

    if (eventName === "messageDelete" || eventName === "messageUpdate") {
        addMessage(eventName === "messageUpdate" ? args[1] : first);
        addMessage(first);
    } else if (eventName === "messageDeleteBulk") {
        for (const message of first?.values?.() || []) addMessage(message);
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

    if (!guild || candidates.size === 0) return false;

    for (const id of candidates) {
        if (await isIgnored(guild.id, id)) {
            console.log(`⏭️ Ignored ${eventName} log for ID ${id}`);
            return true;
        }
    }

    return false;
}

function registerEvent(eventName, handler, logger = null) {
    client.on(eventName, async (...args) => {

        try {
            if (await shouldSkipIgnoredEvent(eventName, args)) return;
        } catch (error) {
            console.error(`❌ Ignore check failed for ${eventName}:`, error);
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
// MESSAGE LOGS
// ========================================

registerEvent(
    "messageDelete",
    events.messageDelete,
    () => console.log("🔥 MESSAGE DELETE EVENT RECEIVED")
);

registerEvent(
    "messageDeleteBulk",
    events.messageDeleteBulk,
    (messages) => {
        console.log(
            `🔥 BULK DELETE EVENT RECEIVED | ${messages.size} messages`
        );
    }
);

registerEvent(
    "messageUpdate",
    events.messageUpdate
);

// ========================================
// MEMBER LOGS
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
// BAN / UNBAN LOGS
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
// CHANNEL LOGS
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
// ROLE LOGS
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
// VOICE CHANNEL LOGS
// ========================================

registerEvent(
    "voiceStateUpdate",
    events.voiceStateUpdate
);

// ========================================
// HTTP HEALTH SERVER
// ========================================

const server = http.createServer((req, res) => {

    // Parse URL safely.
    // Supports /health, /health/, and /health?check=1

    let pathname;

    try {
        pathname = new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
        ).pathname;

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

    // Main health endpoint.
    // HTTP 200 means the Node.js service is responding.
    // Discord status is reported separately.

    if (pathname === "/" || pathname === "/health") {

        const discordConnected = client.isReady();

        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        });

        return res.end(JSON.stringify({
            service: "BauaaCore",
            status: "running",
            discord: discordConnected
                ? "connected"
                : "disconnected",
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
        }));
    }

    // Optional readiness endpoint.
    // Returns 503 if Discord is not connected.

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
            discord: discordConnected
                ? "connected"
                : "disconnected",
            timestamp: new Date().toISOString(),
        }));
    }

    // Unknown routes.

    res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });

    return res.end(JSON.stringify({
        error: "Not Found",
        path: pathname,
    }));
});

// HTTP server error handling.

server.on("error", (error) => {
    console.error("❌ HTTP SERVER ERROR:", error);

    process.exit(1);
});

// Listen on Render's assigned port.

server.listen(PORT, "0.0.0.0", () => {
    console.log("----------------------------------");
    console.log("🌐 BauaaCore HTTP Server Started");
    console.log(`📡 Port: ${PORT}`);
    console.log("❤️ Health: /health");
    console.log("🟢 Readiness: /ready");
    console.log("----------------------------------");
});

// ========================================
// DISCORD CONNECTION MONITOR
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
// BOT READY
// ========================================

client.once("clientReady", async () => {

    console.log("----------------------------------");
    console.log(`✅ ${client.user.tag} is ONLINE!`);
    console.log(`🆔 Bot ID: ${client.user.id}`);
    console.log(`🌐 Servers: ${client.guilds.cache.size}`);
    console.log("----------------------------------");

    try {
        const commands = [
            ...client.commands.values(),
        ].map(command => command.data.toJSON());

        // Register only current project commands.
        // Previous global commands not included here are removed.

        await client.application.commands.set(commands);

        console.log("✅ Global application commands registered!");

    } catch (error) {
        console.error(
            "❌ Failed to register global commands:",
            error
        );
    }
});

// ========================================
// SLASH COMMAND HANDLER
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
        await command.execute(interaction);

    } catch (error) {

        console.error(
            "❌ Command Execution Error:",
            error
        );

        try {
            if (
                interaction.replied ||
                interaction.deferred
            ) {
                await interaction.editReply({
                    content: "❌ An error occurred while executing this command.",
                });

            } else {
                await interaction.reply({
                    content: "❌ An error occurred while executing this command.",
                    ephemeral: true,
                });
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
// PROCESS ERROR MONITOR
// ========================================

process.on("unhandledRejection", (reason) => {
    console.error(
        "❌ Unhandled Promise Rejection:",
        reason
    );
});

process.on("uncaughtException", (error) => {
    console.error(
        "❌ Uncaught Exception:",
        error
    );

    process.exit(1);
});

// ========================================
// GRACEFUL SHUTDOWN
// ========================================

let isShuttingDown = false;

async function shutdown(signal) {

    if (isShuttingDown) return;

    isShuttingDown = true;

    console.log(
        `🛑 ${signal} received. Shutting down BauaaCore...`
    );

    // Disconnect Discord client and close MongoDB.

    client.destroy();
    await closeDatabase().catch((error) => {
        console.error("❌ MongoDB shutdown error:", error);
    });

    // Close HTTP server.

    if (server.listening) {
        await new Promise((resolve) => {
            server.close(resolve);
        });
    }

    console.log("✅ BauaaCore shutdown completed.");

    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ========================================
// DISCORD LOGIN
// ========================================

console.log("🚀 Starting BauaaCore...");

async function startBot() {
    try {
        await connectDatabase();
        await client.login(process.env.DISCORD_TOKEN);
        console.log("🔐 Discord login successful!");
    } catch (error) {
        console.error("❌ Startup failed:", error);
        await closeDatabase().catch(() => {});
        process.exit(1);
    }
}

startBot();
