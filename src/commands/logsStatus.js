const { SlashCommandBuilder, PermissionFlagsBits, OverwriteType } = require("discord.js");
const { getLoggingStatus } = require("../utils/logger");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("logs-status")
        .setDescription("Check the log category, destinations, and bot permissions.")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "Only server administrators can check logging status.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        const guild = interaction.guild;
        const { category, categoryIssue, canViewAuditLog, destinations } = await getLoggingStatus(guild);
        const lines = [
            categoryIssue || `Log category ready: **${category.name}**`,
            canViewAuditLog ? "Audit log access: available" : "Audit log access: missing View Audit Log permission",
            "",
            ...destinations.map(({ name, channel, issue }) => {
                const destination = channel ? `<#${channel.id}>` : `\`#${name}\``;
                const grants = channel?.permissionOverwrites.cache.filter(overwrite =>
                    overwrite.id !== guild.roles.everyone.id && overwrite.id !== guild.members.me?.id &&
                    overwrite.allow.has(PermissionFlagsBits.ViewChannel)
                );
                const access = grants?.size ? ` • Explicit access: ${grants.first(2).map(overwrite =>
                    overwrite.type === OverwriteType.Role ? `<@&${overwrite.id}>` : `<@${overwrite.id}>`
                ).join(", ")}${grants.size > 2 ? ` and ${grants.size - 2} more` : ""}` : "";
                return `- ${destination} — ${issue || "Ready"}${access}`;
            }),
        ];
        return interaction.editReply({ content: lines.join("\n"), allowedMentions: { parse: [] } });
    },
};
