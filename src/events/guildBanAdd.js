const { EmbedBuilder, AuditLogEvent } = require("discord.js");
const { sendAllLog } = require("../utils/allLogger");

module.exports = {
    name: "guildBanAdd",

    async execute(ban) {
        const guild = ban.guild;

        const logChannel = guild.channels.cache.find(
            channel => channel.name === "kick-ban-logs"
        );

        if (!logChannel) return;

        let executor = "Unknown";
        let reason = "No reason provided";

        try {
            const auditLogs = await guild.fetchAuditLogs({
                type: AuditLogEvent.MemberBanAdd,
                limit: 5,
            });

            const entry = auditLogs.entries.find(
                entry =>
                    entry.target?.id === ban.user.id &&
                    Date.now() - entry.createdTimestamp < 10000
            );

            if (entry) {
                executor = entry.executor
                    ? `${entry.executor} \`${entry.executor.tag}\``
                    : "Unknown";

                reason = entry.reason || "No reason provided";
            }
        } catch (error) {
            console.error("❌ Ban Audit Log Error:", error);
        }

        const bannedAt = new Intl.DateTimeFormat("en-IN", {
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
            .setColor(0xED4245)
            .setTitle("🔨 Member Banned")
            .setThumbnail(ban.user.displayAvatarURL({ size: 256 }))
            .setDescription(
                `👤 **User**\n` +
                `${ban.user} \`${ban.user.tag}\`\n\n` +

                `🆔 **User ID**\n` +
                `\`${ban.user.id}\`\n\n` +

                `🛡️ **Banned By**\n` +
                `${executor}\n\n` +

                `📝 **Reason**\n` +
                `${reason}`
            )
            .setFooter({
                text: `BauaaCore • Banned at ${bannedAt} IST`,
            });

        // Detailed log
        await logChannel.send({
            embeds: [embed],
        });

        // Short log in all-logs
        await sendAllLog({
            guild,
            title: "🔨 Member Banned",
            description:
                `👤 **User**\n${ban.user}\n\n` +
                `🛡️ **Banned By**\n${executor}`,
            color: 0xED4245,
        });

        console.log(
            `🔨 Member banned: ${ban.user.tag} by ${executor}`
        );
    },
};