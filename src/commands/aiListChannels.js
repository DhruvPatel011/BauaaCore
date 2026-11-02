const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} = require("discord.js");

const { getAIConfig } = require("../ai/aiConfigManager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-list-channels")
        .setDescription("Show all configured AI channels.")
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

            if (!config.channels.length) {
                return interaction.editReply(
                    "No AI channels configured. Use /ai-setup first."
                );
            }

            const channelNames = await Promise.all(
                config.channels.map(async (channelId, index) => {
                    try {
                        const channel = await interaction.guild.channels.fetch(channelId);

                        return `${index + 1}. ${channel ? channel.toString() : `Deleted/Unavailable (${channelId})`}`;
                    } catch {
                        return `${index + 1}. Deleted/Unavailable (${channelId})`;
                    }
                })
            );

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("BauaaCore AI Channels")
                .setDescription(channelNames.join("\n"))
                .addFields({
                    name: "Total Channels",
                    value: String(config.channels.length),
                    inline: true,
                })
                .setFooter({
                    text: "BauaaCore AI Management",
                })
                .setTimestamp();

            return interaction.editReply({
                embeds: [embed],
            });

        } catch (error) {
            console.error("[AI List Channels Error]", error);

            return interaction.editReply(
                "Failed to retrieve AI channels."
            );
        }
    },
};