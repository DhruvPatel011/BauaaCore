const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} = require("discord.js");

const { getAIConfig } = require("../ai/aiConfigManager");
const { MOODS } = require("../ai/aiConfig");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-status")
        .setDescription("Show the current AI configuration.")
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

            const mood = MOODS[config.mood] || MOODS.default;

            const embed = new EmbedBuilder()
                .setColor(config.enabled ? 0x57F287 : 0xED4245)
                .setTitle("BauaaCore AI Status")
                .addFields(
                    {
                        name: "AI Status",
                        value: config.enabled ? "Enabled" : "Disabled",
                        inline: true,
                    },
                    {
                        name: "Provider",
                        value: config.provider || "Gemini",
                        inline: true,
                    },
                    {
                        name: "AI Mood",
                        value: mood.label,
                        inline: true,
                    },
                    {
                        name: "Configured Channels",
                        value: String(config.channels.length),
                        inline: true,
                    }
                )
                .setFooter({ text: "BauaaCore AI Management" })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error("[AI Status Error]", error);

            return interaction.editReply(
                "Failed to retrieve AI status."
            );
        }
    },
};