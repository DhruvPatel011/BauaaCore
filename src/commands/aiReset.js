const { SlashCommandBuilder } = require("discord.js");

const {
    resetConversation,
} = require("../ai/conversationManager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-reset")
        .setDescription("Reset your personal AI conversation memory."),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: "This command can only be used inside a server.",
                ephemeral: true,
            });
        }

        const wasReset = resetConversation(
            interaction.guildId,
            interaction.user.id
        );

        return interaction.reply({
            content: wasReset
                ? "Your AI conversation memory has been reset successfully."
                : "You don't have any active AI conversation memory.",
            ephemeral: true,
        });
    },
};