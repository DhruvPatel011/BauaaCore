const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { setupLogging } = require("../utils/logger");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("setup-logs")
        .setDescription("Create the complete server logging system.")
        .setDefaultMemberPermissions(
            PermissionFlagsBits.Administrator
        ),

    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: "Only server administrators can set up logging.", ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            await setupLogging(interaction.guild);

            await interaction.editReply(
                "✅ Logging system setup completed! Use /logs-status to check destinations and permissions."
            );
        } catch (error) {
            console.error(error);

            await interaction.editReply(
                "❌ Failed to setup logging system."
            );
        }
    },
};
