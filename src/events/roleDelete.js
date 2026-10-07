const { sendAllLog } = require("../utils/allLogger");

const {
    EmbedBuilder,
    AuditLogEvent,
} = require("discord.js");

function getRoleColor(role) {
    return role.hexColor === "#000000"
        ? "Default"
        : role.hexColor;
}

module.exports = {
    name: "roleDelete",

    async execute(role) {
        if (!role.guild) return;

        const logChannel = role.guild.channels.cache.find(
            channel => channel.name === "role-logs"
        );

        if (!logChannel) {
            console.log("❌ role-logs channel not found");
            return;
        }

        let executor = "Unknown";

        try {
            const auditLogs = await role.guild.fetchAuditLogs({
                type: AuditLogEvent.RoleDelete,
                limit: 10,
            });

            const entry = auditLogs.entries.find(
                entry =>
                    entry.target?.id === role.id &&
                    Date.now() - entry.createdTimestamp < 10000
            );

            if (entry?.executor) {
                executor = `${entry.executor} \`${entry.executor.tag}\``;
            }
        } catch (error) {
            console.error(
                "❌ Role Delete Audit Log Error:",
                error
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

        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle("🔴 Role Deleted")
            .setDescription(
                `🎭 **Role**\n` +
                `@${role.name}\n\n` +

                `📝 **Name**\n` +
                `\`${role.name}\`\n\n` +

                `👤 **Deleted By**\n` +
                `${executor}\n\n` +

                `🎨 **Color**\n` +
                `\`${getRoleColor(role)}\`\n\n` +

                `🆔 **Role ID**\n` +
                `\`${role.id}\``
            )
            .setFooter({
                text: `BauaaCore • Deleted at ${deletedAt} IST`,
            });

        // Detailed log
        await logChannel.send({
            embeds: [embed],
        });

        // Short log in all-logs
        await sendAllLog({
            guild: role.guild,
            title: "🔴 Role Deleted",
            description:
                `🎭 **Role**\n@${role.name}\n\n` +
                `👤 **Deleted By**\n${executor}`,
            color: 0xED4245,
        });

        console.log(
            `🔴 Role deleted: ${role.name} by ${executor}`
        );
    },
};