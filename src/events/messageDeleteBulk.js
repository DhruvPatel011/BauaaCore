const {
    EmbedBuilder,
    AuditLogEvent,
} = require("discord.js");

const {
    sendAllLog,
} = require("../utils/allLogger");

module.exports = {
    name: "messageDeleteBulk",

    async execute(messages, channel) {
        console.log(
            `🗑️ Bulk delete event received: ${messages.size} messages`
        );

        if (!channel?.guild) {
            console.log(
                "⏭️ Bulk delete ignored: no guild"
            );
            return;
        }

        const guild = channel.guild;

        const logChannel =
            guild.channels.cache.find(
                ch =>
                    ch.name ===
                    "deleted-msg-logs"
            );

        if (!logChannel) {
            console.log(
                "❌ deleted-msg-logs channel not found"
            );
            return;
        }

        let executor =
            "Unknown / Audit Log unavailable";

        // ==========================================
        // FIND WHO PERFORMED BULK DELETE
        // ==========================================

        try {
            const auditLogs =
                await guild.fetchAuditLogs({
                    type:
                        AuditLogEvent.MessageBulkDelete,
                    limit: 5,
                });

            const entry =
                auditLogs.entries.find(
                    entry =>
                        entry.target?.id ===
                            channel.id &&
                        Date.now() -
                            entry.createdTimestamp <
                            10000
                );

            if (entry?.executor) {
                executor =
                    `${entry.executor} ` +
                    `\`${entry.executor.tag}\``;
            }
        } catch (error) {
            console.log(
                "⚠️ Could not fetch bulk delete audit log:",
                error.message
            );
        }

        const deletedAt =
            new Intl.DateTimeFormat(
                "en-IN",
                {
                    timeZone: "Asia/Kolkata",
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: true,
                }
            ).format(new Date());

        const count = messages.size;

        // ==========================================
        // EMBED
        // ==========================================

        const embed = new EmbedBuilder()
            .setColor(0xE74C3C)
            .setTitle(
                "🗑️ Bulk Messages Deleted"
            )
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
                    value:
                        `\`${channel.id}\``,
                    inline: true,
                },
                {
                    name: "🗑️ Delete Type",
                    value:
                        "`Bulk Delete`",
                    inline: true,
                },
                {
                    name: "📊 Count",
                    value:
                        `\`${count}\``,
                    inline: true,
                }
            )
            .setFooter({
                text:
                    `BauaaCore • ` +
                    `${deletedAt} IST`,
            });

        // ==========================================
        // DETAILED LOG
        // ==========================================

        await logChannel.send({
            embeds: [embed],
        });

        // ==========================================
        // ALL LOG
        // ==========================================

        await sendAllLog({
            guild,

            title:
                "🗑️ Bulk Messages Deleted",

            description:
                `👤 **Executed By**\n` +
                `${executor}\n\n` +

                `📍 **Channel**\n` +
                `${channel}\n\n` +

                `🗑️ **Messages Deleted**\n` +
                `\`${count}\` messages`,

            color: 0xE74C3C,
        });

        console.log(
            `✅ Bulk delete logged: ` +
            `${count} messages in ` +
            `#${channel.name}`
        );
    },
};