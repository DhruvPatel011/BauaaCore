const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js");

const { setAIMood } = require("../ai/aiConfigManager");
const { MOODS } = require("../ai/aiConfig");

const moodChoices = Object.entries(MOODS).map(([key, mood]) => ({
    name: mood.label,
    value: key,
}));

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-mood")
        .setDescription("Change the server-wide AI personality.")
        .addStringOption(option =>
            option
                .setName("mood")
                .setDescription("Choose an AI personality.")
                .setRequired(true)
                .addChoices(...moodChoices)
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
            const moodKey = interaction.options.getString("mood");
            const selectedMood = MOODS[moodKey];

            if (!selectedMood) {
                return interaction.editReply("Invalid AI mood selected.");
            }

            await setAIMood(interaction.guildId, moodKey);

            return interaction.editReply(
                `AI personality successfully changed to **${selectedMood.label}**.\n` +
                "This mood applies to all configured AI channels in this server."
            );

        } catch (error) {
            console.error("[AI Mood Error]", error);

            return interaction.editReply(
                "Failed to update AI personality."
            );
        }
    },
};