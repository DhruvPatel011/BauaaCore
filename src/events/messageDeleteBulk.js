const { EmbedBuilder, AuditLogEvent } = require("discord.js");
const { sendAllLog } = require("../utils/allLogger");

module.exports = {
    name: "messageDeleteBulk",

    async execute(messages, channel) {
        if (!channel?.guild) return;

        const guild = channel.guild;

        const logChannel = guild.channels.cache.find(
            ch => ch.name === "deleted-msg-logs"
        );

        if (!logChannel) {
            console.log("❌ deleted-msg-logs channel not found");
            return;
        }

        // Find who performed the bulk delete
        let executor = "Unknown";

        try {
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.MessageBulkDelete,
                limit: 5,
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
            console.log(
                "⚠️ Could not fetch bulk delete audit log:",
                error.message
            );
        }

        const deletedAt = new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        }).format(new Date());

        const count = messages.size;

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle("🗑️ Bulk Messages Deleted")
            .setDescription(
                `👤 **Executed By**\n` +
                `${executor}\n\n` +
                `📍 **Channel**\n` +
                `${channel}\n\n` +
                `🗑️ **Messages Deleted**\n` +
                `\`${count}\` messages`
            )
            .addFields(
                {
                    name: "🆔 Channel ID",
                    value: `\`${channel.id}\``,
                    inline: true,
                },
                {
                    name: "🗑️ Delete Type",
                    value: "`Bulk Delete`",
                    inline: true,
                }
            )
            .setFooter({
                text: `BauaaCore • ${deletedAt} IST`,
            });

        // Detailed log
        await logChannel.send({
            embeds: [embed],
        });

        // All logs
        await sendAllLog({
            guild,
            title: "🗑️ Bulk Messages Deleted",
            description:
                `👤 **Executed By**\n${executor}\n\n` +
                `📍 **Channel**\n${channel}\n\n` +
                `🗑️ **Messages Deleted**\n\`${count}\` messages`,
            color: 0xE74C3C,
        });

        console.log(
            `✅ Bulk delete logged: ${count} messages in #${channel.name}`
        );
    },
};