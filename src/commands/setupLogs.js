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
        await interaction.deferReply({ ephemeral: true });

        try {
            await setupLogging(interaction.guild);

            await interaction.editReply(
                "✅ Logging system setup completed!"
            );
        } catch (error) {
            console.error(error);

            await interaction.editReply(
                "❌ Failed to setup logging system."
            );
        }
    },
};
