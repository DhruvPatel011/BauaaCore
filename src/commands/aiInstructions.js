const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js");

const {
    getCustomInstructions,
    setCustomInstructions,
    clearCustomInstructions,
} = require("../ai/instructionManager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-instructions")
        .setDescription("Manage server-specific custom instructions for the AI.")
        .addSubcommand(sub =>
            sub.setName("view").setDescription("Show the current custom instructions.")
        )
        .addSubcommand(sub =>
            sub
                .setName("set")
                .setDescription("Set custom instructions (tone, topics, server context).")
                .addStringOption(option =>
                    option
                        .setName("text")
                        .setDescription("Instructions for the AI in this server")
                        .setRequired(true)
                        .setMaxLength(2000)
                )
        )
        .addSubcommand(sub =>
            sub.setName("clear").setDescription("Remove the custom instructions.")
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
            const sub = interaction.options.getSubcommand();

            if (sub === "view") {
                const text = await getCustomInstructions(interaction.guildId);

                return interaction.editReply(
                    text
                        ? `**Current custom instructions:**\n${text}`.slice(0, 1900)
                        : "No custom instructions are set."
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
                        ? "Custom instructions saved. They apply on top of the built-in rules and can't override them."
                        : `Not saved. ${result.message}`
                );
            }

            if (sub === "clear") {
                const removed = await clearCustomInstructions(interaction.guildId);

                return interaction.editReply(
                    removed ? "Custom instructions removed." : "There were no custom instructions to remove."
                );
            }

            return interaction.editReply("Unknown subcommand.");

        } catch (error) {
            console.error("[AI Instructions Error]", error);

            return interaction.editReply("Failed to update custom instructions.");
        }
    },
};
