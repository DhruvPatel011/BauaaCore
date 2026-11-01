
require("dotenv").config();

const http = require("http");

const {
    Client,
    GatewayIntentBits,
    Collection,
    Partials,
} = require("discord.js");

// ========================================
// COMMANDS
// ========================================

const setupLogsCommand = require("./commands/setupLogs");

// ========================================
// EVENTS
// ========================================

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

// ========================================
// CONFIGURATION
// ========================================

const PORT = Number(process.env.PORT) || 10000;

if (!process.env.DISCORD_TOKEN) {
    console.error("❌ DISCORD_TOKEN is missing!");
    process.exit(1);
}

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

// ========================================
// EVENT REGISTRATION HELPER
// ========================================

function registerEvent(eventName, handler, logger = null) {
    client.on(eventName, async (...args) => {

        if (logger) {
            try {
                logger(...args);
            } catch (error) {
                console.error(
                    `❌ ${eventName} log message error:`,
                    error
                );
            }
        }

        try {
            await handler.execute(...args);
        } catch (error) {
            console.error(
                `❌ ${eventName} Logger Error:`,
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
    messageDelete,
    () => console.log("🔥 MESSAGE DELETE EVENT RECEIVED")
);

registerEvent(
    "messageDeleteBulk",
    messageDeleteBulk,
    (messages) => {
        console.log(
            `🔥 BULK DELETE EVENT RECEIVED | ${messages.size} messages`
        );
    }
);

registerEvent(
    "messageUpdate",
    messageUpdate
);

// ========================================
// MEMBER LOGS
// ========================================

registerEvent(
    "guildMemberAdd",
    guildMemberAdd
);

registerEvent(
    "guildMemberRemove",
    guildMemberRemove
);

registerEvent(
    "guildMemberUpdate",
    guildMemberUpdate
);

// ========================================
// BAN / UNBAN LOGS
// ========================================

registerEvent(
    "guildBanAdd",
    guildBanAdd,
    (ban) => {
        console.log(
            "🔨 BAN EVENT RECEIVED:",
            ban.user?.tag || "Unknown user"
        );
    }
);

registerEvent(
    "guildBanRemove",
    guildBanRemove,
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
    channelCreate
);

registerEvent(
    "channelDelete",
    channelDelete
);

registerEvent(
    "channelUpdate",
    channelUpdate
);

// ========================================
// ROLE LOGS
// ========================================

registerEvent(
    "roleCreate",
    roleCreate
);

registerEvent(
    "roleDelete",
    roleDelete
);

registerEvent(
    "roleUpdate",
    roleUpdate
);

// ========================================
// VOICE LOGS
// ========================================

registerEvent(
    "voiceStateUpdate",
    voiceStateUpdate
);

// ========================================
// HTTP HEALTH SERVER
// ========================================

const server = http.createServer((req, res) => {

    if (req.url === "/" || req.url === "/health") {

        const discordConnected = client.isReady();

        res.writeHead(200, {
            "Content-Type": "application/json",
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

    res.writeHead(404, {
        "Content-Type": "application/json",
    });

    res.end(JSON.stringify({
        error: "Not Found",
    }));
});

server.on("error", (error) => {
    console.error("❌ HTTP SERVER ERROR:", error);
    process.exit(1);
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
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
// SLASH COMMANDS
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

    // Exit so the hosting platform can restart
    // the process instead of continuing in an
    // unknown application state.

    process.exit(1);
});

// ========================================
// GRACEFUL SHUTDOWN
// ========================================

let isShuttingDown = false;


let isShuttingDown = false;

async function shutdown(signal) {
    if (isShuttingDown) return;

    isShuttingDown = true;

    console.log(`🛑 ${signal} received. Shutting down BauaaCore...`);

    client.destroy();

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

client.login(process.env.DISCORD_TOKEN)
    .then(() => {
        console.log("🔐 Discord login successful!");
    })
    .catch((error) => {
        console.error("❌ Discord login failed:", error);
        process.exit(1);
    });
