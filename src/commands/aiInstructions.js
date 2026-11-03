
"use strict";

const { SlashCommandBuilder } = require("discord.js");

const {
    getCustomInstructions,
    setCustomInstructions,
    clearCustomInstructions,
} = require("../ai/instructionManager");

// Only this Discord account can manage AI instructions.
const BOT_OWNER_ID = process.env.BOT_OWNER_ID;

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-instructions")
        .setDescription("Manage BauaaCore AI instructions.")

        .addSubcommand(sub =>
            sub
                .setName("view")
                .setDescription("View current AI instructions.")
        )

        .addSubcommand(sub =>
            sub
                .setName("set")
                .setDescription("Update AI instructions.")
                .addStringOption(option =>
                    option
                        .setName("text")
                        .setDescription("New AI instructions.")
                        .setRequired(true)
                        .setMaxLength(2000)
                )
        )

        .addSubcommand(sub =>
            sub
                .setName("clear")
                .setDescription("Reset custom AI instructions.")
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: "This command only works inside a Discord server.",
                ephemeral: true,
            });
        }

        // Security: fail closed if owner ID is not configured.
        if (!BOT_OWNER_ID || interaction.user.id !== BOT_OWNER_ID) {
            return interaction.reply({
                content: "Access denied. Only Bauaa can manage my AI instructions.",
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        try {
            const sub = interaction.options.getSubcommand();

            if (sub === "view") {
                const text = await getCustomInstructions(
                    interaction.guildId
                );

                return interaction.editReply(
                    text
                        ? `**Current AI Instructions:**\n${text}`.slice(0, 1900)
                        : "No custom instructions are configured."
                );
            }

            if (sub === "set") {
                const result = await setCustomInstructions(
                    interaction.guildId,
                    interaction.options.getString("text", true),
                    interaction.user.id
                );

                return interaction.editReply(
                    result.ok
                        ? "AI instructions successfully updated by Bauaa."
                        : `Update failed: ${result.message}`
                );
            }

            if (sub === "clear") {
                const removed = await clearCustomInstructions(
                    interaction.guildId
                );

                return interaction.editReply(
                    removed
                        ? "Custom AI instructions have been reset."
                        : "No custom instructions were configured."
                );
            }

            return interaction.editReply("Unknown subcommand.");

        } catch (error) {
            console.error("[AI Instructions Error]", error);

            return interaction.editReply(
                "An error occurred while processing AI instructions."
            );
        }
    },
};
