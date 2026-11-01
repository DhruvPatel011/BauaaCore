
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

    // Voice channel activity logs only.
    // No music playback or Lavalink.
    voiceStateUpdate: require("./events/voiceStateUpdate"),
};

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
// EVENT REGISTRATION
// ========================================

function registerEvent(eventName, handler, logger = null) {
    client.on(eventName, async (...args) => {

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

        // Registers only the commands in this project.
        // Old global music commands will be removed.

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
        console.error(
            "❌ Discord login failed:",
            error
        );

        process.exit(1);
    });
