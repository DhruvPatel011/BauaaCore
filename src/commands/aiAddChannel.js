const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
} = require("discord.js");

const {
    addAIChannel,
    getAIConfig,
} = require("../ai/aiConfigManager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-add-channel")
        .setDescription("Add another AI chat channel.")
        .addStringOption(option =>
            option
                .setName("id")
                .setDescription("Text channel ID")
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

            const channel = await interaction.guild.channels.fetch(channelId);

            if (
                !channel ||
                channel.guildId !== interaction.guildId ||
                ![
                    ChannelType.GuildText,
                    ChannelType.GuildAnnouncement,
                ].includes(channel.type)
            ) {
                return interaction.editReply(
                    "Please provide a valid text or announcement channel from this server."
                );
            }

            const config = await getAIConfig(interaction.guildId);

            if (config.channels.includes(channelId)) {
                return interaction.editReply(
                    `${channel} is already an AI channel.`
                );
            }

            await addAIChannel(interaction.guildId, channelId);

            const updatedConfig = await getAIConfig(interaction.guildId);

            return interaction.editReply(
                `Successfully added ${channel} as an AI channel.\n` +
                `Total AI Channels: ${updatedConfig.channels.length}`
            );

        } catch (error) {
            console.error("[AI Add Channel Error]", error);

            return interaction.editReply(
                "Unable to add this channel. Verify the channel ID and bot permissions."
            );
        }
    },
};