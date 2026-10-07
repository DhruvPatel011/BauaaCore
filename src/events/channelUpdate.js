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
    name: "channelUpdate",

    async execute(oldChannel, newChannel) {
        if (!newChannel.guild) return;

        const changes = [];

        if (oldChannel.name !== newChannel.name) {
            changes.push(
                `📝 **Name**\n` +
                `Before: \`${oldChannel.name}\`\n` +
                `After: \`${newChannel.name}\``
            );
        }

        if (oldChannel.topic !== newChannel.topic) {
            changes.push(
                `📄 **Topic**\n` +
                `Before: ${oldChannel.topic || "*None*"}\n` +
                `After: ${newChannel.topic || "*None*"}`
            );
        }

        if (oldChannel.nsfw !== newChannel.nsfw) {
            changes.push(
                `🔞 **NSFW**\n` +
                `Before: \`${oldChannel.nsfw ? "Enabled" : "Disabled"}\`\n` +
                `After: \`${newChannel.nsfw ? "Enabled" : "Disabled"}\``
            );
        }

        if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
            changes.push(
                `⏱️ **Slowmode**\n` +
                `Before: \`${oldChannel.rateLimitPerUser}s\`\n` +
                `After: \`${newChannel.rateLimitPerUser}s\``
            );
        }

        if (oldChannel.parentId !== newChannel.parentId) {
            changes.push(
                `📁 **Category Changed**`
            );
        }

        if (changes.length === 0) return;

        const logChannel = newChannel.guild.channels.cache.find(
            ch => ch.name === "channel-logs"
        );

        if (!logChannel) {
            console.log("❌ channel-logs channel not found");
            return;
        }

        let executor = "Unknown";
        let reason = "No reason provided";

        try {
            const auditLogs = await newChannel.guild.fetchAuditLogs({
                type: AuditLogEvent.ChannelUpdate,
                limit: 10,
            });

            const entry = auditLogs.entries.find(
                entry =>
                    entry.target?.id === newChannel.id &&
                    Date.now() - entry.createdTimestamp < 10000
            );

            if (entry) {
                if (entry.executor) {
                    executor = `${entry.executor} \`${entry.executor.tag}\``;
                }

                reason = entry.reason || "No reason provided";
            }
        } catch (error) {
            console.error("❌ Channel Update Audit Log Error:", error);
        }

        const embed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle("✏️ Channel Updated")
            .setDescription(
                `📌 **Channel**\n${newChannel}\n\n` +
                `📂 **Type**\n${getChannelType(newChannel)}\n\n` +
                `${changes.join("\n\n")}\n\n` +
                `👤 **Updated By**\n${executor}\n\n` +
                `📝 **Reason**\n${reason}\n\n` +
                `🆔 **Channel ID**\n\`${newChannel.id}\``
            )
            .setFooter({
                text: `BauaaCore • Updated at ${getTime()} IST`,
            });

        await logChannel.send({
            embeds: [embed],
        });

        await sendAllLog({
            guild: newChannel.guild,
            title: "✏️ Channel Updated",
            description:
                `📌 **Channel**\n${newChannel}\n\n` +
                `👤 **Updated By**\n${executor}`,
            color: 0xF1C40F,
        });

        console.log(`✏️ Channel updated: ${newChannel.name}`);
    },
};