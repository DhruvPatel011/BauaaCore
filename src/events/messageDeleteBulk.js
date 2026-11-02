
const {
    EmbedBuilder,
    AuditLogEvent,
} = require("discord.js");

const { sendAllLog } = require("../utils/allLogger");
const { isMessageIgnored } = require("../utils/ignoreManager");

module.exports = {
    name: "messageDeleteBulk",

    async execute(messages, channel) {
        try {
            if (!channel?.guild) {
                console.log("⏭️ Bulk delete ignored: No guild");
                return;
            }

            const guild = channel.guild;

            // Filter ignored users, bots and webhooks
            const visibleMessages = [];

            for (const message of messages.values()) {
                if (await isMessageIgnored(message)) {
                    continue;
                }

                visibleMessages.push(message);
            }

            // Stop if every message belongs to ignored entities
            if (visibleMessages.length === 0) {
                console.log(
                    "⏭️ Bulk delete ignored: All messages belong to ignored entities"
                );
                return;
            }

            const logChannel = guild.channels.cache.find(
                ch => ch.name === "deleted-msg-logs"
            );

            if (!logChannel) {
                console.log("❌ deleted-msg-logs channel not found");
                return;
            }

            // Find bulk delete executor
            let executor = "Unknown / Audit Log unavailable";

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
                    executor =
                        `${entry.executor} ` +
                        `\`${entry.executor.tag || entry.executor.username}\``;
                }
            } catch (error) {
                console.error(
                    "⚠️ Bulk delete audit log error:",
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

            const count = visibleMessages.length;

            const embed = new EmbedBuilder()
                .setColor(0xE74C3C)
                .setTitle("🗑️ Bulk Messages Deleted")
                .setDescription(
                    `👤 **Executed By**\n${executor}\n\n` +
                    `📍 **Channel**\n${channel}\n\n` +
                    `🗑️ **Eligible Messages Deleted**\n` +
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
                    },
                    {
                        name: "📊 Eligible Count",
                        value: `\`${count}\``,
                        inline: true,
                    }
                )
                .setFooter({
                    text: `BauaaCore • ${deletedAt} IST`,
                });

            // Dedicated log
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
                    `🗑️ **Eligible Messages Deleted**\n` +
                    `\`${count}\` messages`,
                color: 0xE74C3C,
            });

            console.log(
                `✅ Bulk delete logged: ${count} eligible messages in #${channel.name}`
            );

        } catch (error) {
            console.error("❌ Bulk Delete Log Error:", error);
        }
    },
};
