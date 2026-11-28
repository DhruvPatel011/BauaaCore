const { SlashCommandBuilder, MessageFlags } = require("discord.js");

const {
    resetConversation,
} = require("../ai/conversationManager");
const { cancelActiveRequest } = require("../events/messageCreate");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-reset")
        .setDescription("Reset your current Zoya chat and its language."),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: "This command can only be used inside a server.",
                ephemeral: true,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { guildId, user } = interaction;
        const cancelled = cancelActiveRequest(guildId, user.id);
        const wasReset = resetConversation(guildId, user.id);

        return interaction.editReply({
            content: wasReset || cancelled
                ? "Your Zoya chat was reset. The default language is Hinglish."
                : "You don't have an active Zoya chat to reset.",
        });
    },
};
