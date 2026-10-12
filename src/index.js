
require("dotenv").config();

const http = require("http");
const {
    Client,
    GatewayIntentBits,
    Collection,
    Partials,
} = require("discord.js");

// ========================================
// HTTP SERVER (Render)
// ========================================

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
    if (req.url === "/health") {
        res.writeHead(200, {
            "Content-Type": "application/json",
        });

        return res.end(JSON.stringify({
            status: "ok",
            service: "BauaaCore",
        }));
    }

    res.writeHead(200, {
        "Content-Type": "text/plain",
    });

    res.end("BauaaCore is online!");
});

server.listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
});

// ========================================
// IMPORT EVENTS AND COMMANDS
// ========================================

const setupLogsCommand = require("./commands/setupLogs");

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
// DISCORD CLIENT
// ========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
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
// MESSAGE LOG EVENTS
// ========================================

client.on("messageDelete", async (message) => {
    console.log("🔥 MESSAGE DELETE EVENT RECEIVED");

    try {
        await messageDelete.execute(message);
    } catch (error) {
        console.error("❌ Message Delete Logger Error:", error);
    }
});

client.on("messageDeleteBulk", async (messages, channel) => {
    console.log(
        `🔥 BULK DELETE EVENT RECEIVED | ${messages.size} messages`
    );

    try {
        await messageDeleteBulk.execute(messages, channel);
    } catch (error) {
        console.error("❌ Bulk Message Delete Logger Error:", error);
    }
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
    try {
        await messageUpdate.execute(oldMessage, newMessage);
    } catch (error) {
        console.error("❌ Message Update Logger Error:", error);
    }
});

// ========================================
// MEMBER LOG EVENTS
// ========================================

client.on("guildMemberAdd", async (member) => {
    try {
        await guildMemberAdd.execute(member);
    } catch (error) {
        console.error("❌ Member Join Logger Error:", error);
    }
});

client.on("guildMemberRemove", async (member) => {
    try {
        await guildMemberRemove.execute(member);
    } catch (error) {
        console.error("❌ Member Leave Logger Error:", error);
    }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
        await guildMemberUpdate.execute(oldMember, newMember);
    } catch (error) {
        console.error("❌ Member Update Logger Error:", error);
    }
});

// ========================================
// BAN / UNBAN LOG EVENTS
// ========================================

client.on("guildBanAdd", async (ban) => {
    try {
        await guildBanAdd.execute(ban);
    } catch (error) {
        console.error("❌ Ban Logger Error:", error);
    }
});

client.on("guildBanRemove", async (ban) => {
    try {
        await guildBanRemove.execute(ban);
    } catch (error) {
        console.error("❌ Unban Logger Error:", error);
    }
});

// ========================================
// CHANNEL LOG EVENTS
// ========================================

client.on("channelCreate", async (channel) => {
    try {
        await channelCreate.execute(channel);
    } catch (error) {
        console.error("❌ Channel Create Logger Error:", error);
    }
});

client.on("channelDelete", async (channel) => {
    try {
        await channelDelete.execute(channel);
    } catch (error) {
        console.error("❌ Channel Delete Logger Error:", error);
    }
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
    try {
        await channelUpdate.execute(oldChannel, newChannel);
    } catch (error) {
        console.error("❌ Channel Update Logger Error:", error);
    }
});

// ========================================
// ROLE LOG EVENTS
// ========================================

client.on("roleCreate", async (role) => {
    try {
        await roleCreate.execute(role);
    } catch (error) {
        console.error("❌ Role Create Logger Error:", error);
    }
});

client.on("roleDelete", async (role) => {
    try {
        await roleDelete.execute(role);
    } catch (error) {
        console.error("❌ Role Delete Logger Error:", error);
    }
});

client.on("roleUpdate", async (oldRole, newRole) => {
    try {
        await roleUpdate.execute(oldRole, newRole);
    } catch (error) {
        console.error("❌ Role Update Logger Error:", error);
    }
});

// ========================================
// VOICE LOG EVENTS
// ========================================

client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
        await voiceStateUpdate.execute(oldState, newState);
    } catch (error) {
        console.error("❌ Voice Logger Error:", error);
    }
});

// ========================================
// DISCORD CONNECTION MONITOR
// ========================================

client.on("shardDisconnect", (event, shardId) => {
    console.warn(
        `[GATEWAY DISCONNECT] ${new Date().toISOString()} | ` +
        `Shard: ${shardId} | ` +
        `Code: ${event.code} | ` +
        `Reason: ${event.reason || "Unknown"}`
    );
});

client.on("shardReconnecting", (shardId) => {
    console.warn(
        `🟡 Discord Gateway reconnecting | Shard: ${shardId}`
    );
});

client.on("shardResume", (shardId, replayedEvents) => {
    console.log(
        `🟢 Discord Gateway resumed | Shard: ${shardId} | ` +
        `Replayed: ${replayedEvents}`
    );
});

client.on("shardError", (error, shardId) => {
    console.error(
        `❌ Gateway shard error (${shardId}):`,
        error
    );
});

client.on("error", (error) => {
    console.error("❌ Discord Client Error:", error);
});

client.on("invalidated", () => {
    console.error(
        "❌ Discord session invalidated. Check Discord Gateway logs."
    );
});

// ========================================
// BOT READY
// ========================================

client.once("clientReady", async () => {
    console.log(`✅ ${client.user.tag} is online!`);

    try {
        const commands = [...client.commands.values()].map(
            (command) => command.data.toJSON()
        );

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

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error("❌ Command Execution Error:", error);

        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply(
                    "❌ An error occurred while executing this command."
                );
            } else {
                await interaction.reply({
                    content:
                        "❌ An error occurred while executing this command.",
                    ephemeral: true,
                });
            }
        } catch (replyError) {
            console.error("❌ Interaction Reply Error:", replyError);
        }
    }
});

// ========================================
// DISCORD HEALTH MONITOR
// ========================================

setInterval(() => {
    console.log(
        `[HEALTH] ${new Date().toISOString()} | ` +
        `Process: RUNNING | ` +
        `Discord Ready: ${client.isReady()} | ` +
        `WS Status: ${client.ws.status} | ` +
        `Ping: ${client.ws.ping}ms`
    );
}, 60_000);

// ========================================
// LOGIN — KEEP THIS ONLY ONCE
// ========================================

client.login(process.env.DISCORD_TOKEN).catch((error) => {
    console.error("❌ Discord login failed:", error);
});
