const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js");

const {
    setAIEnabled,
    getAIConfig,
} = require("../ai/aiConfigManager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-disable")
        .setDescription("Disable AI responses in this server.")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: "This command can only be used inside a server.",
                ephemeral: true,
            });
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: "Only administrators can use this command.",
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const config = await getAIConfig(interaction.guildId);

            if (!config.enabled) {
                return interaction.editReply("AI is already disabled.");
            }

            await setAIEnabled(interaction.guildId, false);

            return interaction.editReply(
                "AI has been successfully disabled for this server."
            );

        } catch (error) {
            console.error("[AI Disable Error]", error);

            return interaction.editReply("Failed to disable AI.");
        }
    },
};