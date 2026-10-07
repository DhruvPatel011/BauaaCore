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
    name: "roleUpdate",

    async execute(oldRole, newRole) {
        if (!newRole.guild) return;

        const changes = [];

        // Name changed
        if (oldRole.name !== newRole.name) {
            changes.push(
                `📝 **Name**\n` +
                `Before: \`${oldRole.name}\`\n` +
                `After: \`${newRole.name}\``
            );
        }

        // Color changed
        if (oldRole.hexColor !== newRole.hexColor) {
            changes.push(
                `🎨 **Color**\n` +
                `Before: \`${getRoleColor(oldRole)}\`\n` +
                `After: \`${getRoleColor(newRole)}\``
            );
        }

        // Permissions changed
        if (
            oldRole.permissions.bitfield !==
            newRole.permissions.bitfield
        ) {
            changes.push(
                `🔐 **Permissions**\n` +
                `Role permissions were updated.`
            );
        }

        // Hoist changed
        if (oldRole.hoist !== newRole.hoist) {
            changes.push(
                `📌 **Display Separately**\n` +
                `Before: \`${oldRole.hoist ? "Enabled" : "Disabled"}\`\n` +
                `After: \`${newRole.hoist ? "Enabled" : "Disabled"}\``
            );
        }

        // Mentionable changed
        if (oldRole.mentionable !== newRole.mentionable) {
            changes.push(
                `🔔 **Mentionable**\n` +
                `Before: \`${oldRole.mentionable ? "Enabled" : "Disabled"}\`\n` +
                `After: \`${newRole.mentionable ? "Enabled" : "Disabled"}\``
            );
        }

        if (changes.length === 0) return;

        const logChannel = newRole.guild.channels.cache.find(
            channel => channel.name === "role-logs"
        );

        if (!logChannel) {
            console.log("❌ role-logs channel not found");
            return;
        }

        let executor = "Unknown";

        try {
            const auditLogs = await newRole.guild.fetchAuditLogs({
                type: AuditLogEvent.RoleUpdate,
                limit: 10,
            });

            const entry = auditLogs.entries.find(
                entry =>
                    entry.target?.id === newRole.id &&
                    Date.now() - entry.createdTimestamp < 10000
            );

            if (entry?.executor) {
                executor = `${entry.executor} \`${entry.executor.tag}\``;
            }
        } catch (error) {
            console.error(
                "❌ Role Update Audit Log Error:",
                error
            );
        }

        const updatedAt = new Intl.DateTimeFormat("en-IN", {
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
            .setColor(0xF1C40F)
            .setTitle("✏️ Role Updated")
            .setDescription(
                `🎭 **Role**\n` +
                `${newRole}\n\n` +

                `👤 **Updated By**\n` +
                `${executor}\n\n` +

                `${changes.join("\n\n")}\n\n` +

                `🆔 **Role ID**\n` +
                `\`${newRole.id}\``
            )
            .setFooter({
                text: `BauaaCore • Updated at ${updatedAt} IST`,
            });

        // Detailed log
        await logChannel.send({
            embeds: [embed],
        });

        // Short log in all-logs
        await sendAllLog({
            guild: newRole.guild,
            title: "✏️ Role Updated",
            description:
                `🎭 **Role**\n${newRole}\n\n` +
                `👤 **Updated By**\n${executor}`,
            color: 0xF1C40F,
        });

        console.log(
            `✏️ Role updated: ${newRole.name} by ${executor}`
        );
    },
};