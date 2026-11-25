const { InteractionContextType, SlashCommandBuilder } = require("discord.js");
const { replyPrivately } = require("../games/session");
const { playRps, playGuess } = require("../games/quickPlay");
const { playTicTacToe } = require("../games/ticTacToe");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("game")
        .setDescription("Play a quick game with BauaaCore or a server member.")
        .setContexts(InteractionContextType.Guild)
        .addSubcommand(sub => sub.setName("rps").setDescription("Play Rock Paper Scissors against BauaaCore."))
        .addSubcommand(sub => sub.setName("guess").setDescription("Guess the secret number in three tries."))
        .addSubcommand(sub => sub.setName("tictactoe")
            .setDescription("Challenge another server member to Tic-Tac-Toe.")
            .addUserOption(option => option.setName("opponent").setDescription("Member to challenge").setRequired(true))),

    async execute(interaction) {
        if (!interaction.inGuild()) return replyPrivately(interaction, "Use this command in a Discord server.");

        switch (interaction.options.getSubcommand()) {
            case "rps": return playRps(interaction);
            case "guess": return playGuess(interaction);
            case "tictactoe": return playTicTacToe(interaction, interaction.options.getUser("opponent", true));
            default: return replyPrivately(interaction, "Choose one of the available games.");
        }
    },
};
