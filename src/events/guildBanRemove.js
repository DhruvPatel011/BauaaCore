const { EmbedBuilder, AuditLogEvent } = require("discord.js");
const { sendAllLog } = require("../utils/allLogger");

module.exports = {
    name: "guildBanRemove",

    async execute(ban) {
        const guild = ban.guild;

        const logChannel = guild.channels.cache.find(
            channel => channel.name === "kick-ban-logs"
        );

        if (!logChannel) return;

        let executor = "Unknown";

        try {
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.MemberBanRemove,
                limit: 5,
            });

            const entry = auditLogs.entries.find(
                entry =>
                    entry.target?.id === ban.user.id &&
                    Date.now() - entry.createdTimestamp < 10000
            );

            if (entry && entry.executor) {
                executor = `${entry.executor} \`${entry.executor.tag}\``;
            }
        } catch (error) {
            console.error("❌ Unban Audit Log Error:", error);
        }

        const unbannedAt = new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        }).format(new Date());

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle("🔓 Member Unbanned")
            .setThumbnail(ban.user.displayAvatarURL({ size: 256 }))
            .setDescription(
                `👤 **User**\n` +
                `${ban.user} \`${ban.user.tag}\`\n\n` +

                `🆔 **User ID**\n` +
                `\`${ban.user.id}\`\n\n` +

                `🛡️ **Unbanned By**\n` +
                `${executor}`
            )
            .setFooter({
                text: `BauaaCore • Unbanned at ${unbannedAt} IST`,
            });

            await sendAllLog({
                guild,
                title: "🔓 Member Unbanned",
                description:
                    `👤 **User**\n${ban.user}\n\n` +
                    `🛡️ **Unbanned By**\n${executor}`,
                color: 0x57F287,
            });
    },
};