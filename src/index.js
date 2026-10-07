require("dotenv").config();

const http = require("http");

const PORT = process.env.PORT || 10000;

http.createServer((req, res) => {
    res.writeHead(200);
    res.end("BauaaCore is online!");
}).listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
});

const {
    Client,
    GatewayIntentBits,
    Collection,
} = require("discord.js");

const setupLogsCommand = require("./commands/setupLogs");

const messageDelete = require("./events/messageDelete");
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


const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ],
});


client.commands = new Collection();

client.commands.set(
    setupLogsCommand.data.name,
    setupLogsCommand
);


// ================================
// MESSAGE LOGS
// ================================

client.on("messageDelete", async (message) => {
    try {
        await messageDelete.execute(message);
    } catch (error) {
        console.error("❌ Message Delete Logger Error:", error);
    }
});


client.on("messageUpdate", async (oldMessage, newMessage) => {
    try {
        await messageUpdate.execute(oldMessage, newMessage);
    } catch (error) {
        console.error("❌ Message Update Logger Error:", error);
    }
});


// ================================
// MEMBER LOGS
// ================================

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


// ================================
// BAN / UNBAN LOGS
// ================================

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


// ================================
// CHANNEL LOGS
// ================================

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


// ================================
// ROLE LOGS
// ================================

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


// ================================
// VOICE LOGS
// ================================

client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
        await voiceStateUpdate.execute(oldState, newState);
    } catch (error) {
        console.error("❌ Voice Logger Error:", error);
    }
});


// ================================
// BOT READY
// ================================

client.once("ready", async () => {
    console.log(`✅ ${client.user.tag} is online!`);

    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.commands.set(
                [...client.commands.values()].map(command =>
                    command.data.toJSON()
                )
            );

            console.log(
                `✅ Commands registered in: ${guild.name}`
            );

        } catch (error) {
            console.error(
                `❌ Failed to register commands in ${guild.name}:`,
                error
            );
        }
    }
});


// ================================
// SLASH COMMANDS
// ================================

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(
        interaction.commandName
    );

    if (!command) return;

    try {
        await command.execute(interaction);

    } catch (error) {
        console.error(
            "❌ Command Execution Error:",
            error
        );

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
            console.error(
                "❌ Interaction Reply Error:",
                replyError
            );
        }
    }
});


// ================================
// LOGIN
// ================================

client.login(process.env.DISCORD_TOKEN);