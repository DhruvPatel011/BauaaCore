const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} = require("discord.js");

const { getAIConfig } = require("../ai/aiConfigManager");
const { MOODS, getRuntimeSettings } = require("../ai/aiConfig");
const { getCustomInstructions } = require("../ai/instructionManager");
const { getGuildUsage } = require("../ai/usageLimiter");

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
            const settings = getRuntimeSettings();
            const mood = MOODS[config.mood] || MOODS.default;
            const usageToday = getGuildUsage(interaction.guildId);

            let hasInstructions = false;

            try {
                hasInstructions = Boolean(await getCustomInstructions(interaction.guildId));
            } catch {
                // Status should still work if this lookup fails.
            }

            const embed = new EmbedBuilder()
                .setColor(config.enabled ? 0x57F287 : 0xED4245)
                .setTitle("BauaaCore AI Status")
                .addFields(
                    { name: "AI Status", value: config.enabled ? "Enabled" : "Disabled", inline: true },
                    { name: "Provider", value: "Groq", inline: true },
                    { name: "Model", value: settings.model, inline: true },
                    { name: "AI Mood", value: mood.label, inline: true },
                    { name: "Configured Channels", value: String(config.channels.length), inline: true },
                    { name: "Long-term Memory", value: settings.longTermMemory ? "On (opt-in per user)" : "Off", inline: true },
                    { name: "Custom Instructions", value: hasInstructions ? "Set" : "Not set", inline: true },
                    {
                        name: "Requests Today (since last restart)",
                        value: `${usageToday.used} / ${usageToday.limit}`,
                        inline: true,
                    }
                )
                .setFooter({ text: "BauaaCore AI Management" })
                .setTimestamp();

            return interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error("[AI Status Error]", error);

            return interaction.editReply("Failed to retrieve AI status.");
        }
    },
};
