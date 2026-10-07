const {
    EmbedBuilder,
    AuditLogEvent,
} = require("discord.js");

const { sendAllLog } = require("../utils/allLogger");

function getChannelType(channel) {
    switch (channel.type) {
        case 0:
            return "💬 Text Channel";
        case 2:
            return "🔊 Voice Channel";
        case 4:
            return "📁 Category";
        case 5:
            return "📢 Announcement Channel";
        case 10:
            return "🧵 Public Thread";
        case 11:
            return "🧵 Private Thread";
        case 12:
            return "🧵 Announcement Thread";
        case 13:
            return "🎤 Stage Channel";
        case 15:
            return "📝 Forum Channel";
        default:
            return "📌 Other Channel";
    }
}

function getTime() {
    return new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    }).format(new Date());
}

module.exports = {
    name: "channelCreate",

    async execute(channel) {
        if (!channel.guild) return;

        const logChannel = channel.guild.channels.cache.find(
            ch => ch.name === "channel-logs"
        );

        if (!logChannel) {
            console.log("❌ channel-logs channel not found");
            return;
        }

        let executor = "Unknown";

        try {
            const auditLogs = await channel.guild.fetchAuditLogs({
                type: AuditLogEvent.ChannelCreate,
                limit: 10,
            });

            const entry = auditLogs.entries.find(
                entry =>
                    entry.target?.id === channel.id &&
                    Date.now() - entry.createdTimestamp < 10000
            );

            if (entry?.executor) {
                executor = `${entry.executor} \`${entry.executor.tag}\``;
            }
        } catch (error) {
            console.error("❌ Channel Create Audit Log Error:", error);
        }

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle("📁 Channel Created")
            .setDescription(
                `📌 **Channel**\n${channel}\n\n` +
                `📝 **Name**\n\`${channel.name}\`\n\n` +
                `📂 **Type**\n${getChannelType(channel)}\n\n` +
                `👤 **Created By**\n${executor}\n\n` +
                `🆔 **Channel ID**\n\`${channel.id}\``
            )
            .setFooter({
                text: `BauaaCore • Created at ${getTime()} IST`,
            });

        await logChannel.send({
            embeds: [embed],
        });

        await sendAllLog({
            guild: channel.guild,
            title: "📁 Channel Created",
            description:
                `📌 **Channel**\n${channel}\n\n` +
                `👤 **Created By**\n${executor}`,
            color: 0x57F287,
        });

        console.log(`📁 Channel created: ${channel.name}`);
    },
};