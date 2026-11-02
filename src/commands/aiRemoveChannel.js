const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js");

const {
    removeAIChannel,
    getAIConfig,
} = require("../ai/aiConfigManager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-remove-channel")
        .setDescription("Remove an AI chat channel.")
        .addStringOption(option =>
            option
                .setName("id")
                .setDescription("AI channel ID")
                .setRequired(true)
        )
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
            const channelId = interaction.options.getString("id").trim();

            if (!/^\d{17,20}$/.test(channelId)) {
                return interaction.editReply("Invalid Discord channel ID.");
            }

            const config = await getAIConfig(interaction.guildId);

            if (!config.channels.includes(channelId)) {
                return interaction.editReply(
                    "This channel is not configured as an AI channel."
                );
            }

            await removeAIChannel(interaction.guildId, channelId);

            const updatedConfig = await getAIConfig(interaction.guildId);

            return interaction.editReply(
                `Successfully removed <#${channelId}> from AI channels.\n` +
                `Remaining AI Channels: ${updatedConfig.channels.length}`
            );

        } catch (error) {
            console.error("[AI Remove Channel Error]", error);

            return interaction.editReply(
                "Failed to remove the AI channel."
            );
        }
    },
};