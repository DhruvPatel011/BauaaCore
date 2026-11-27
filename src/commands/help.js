const { MessageFlags, SlashCommandBuilder } = require("discord.js");
const { createHelpBrowser } = require("../help/browser");
const { generalCategories, musicCategories } = require("../help/categories");

const data = new SlashCommandBuilder().setName("help").setDescription("Browse BauaaCore commands and learn how to use them.");

function createHelpCommand(commands) {
    const categories = [
        ...generalCategories,
        ...musicCategories,
        ["Help", "Open the command guide.", "commands", ["help"]],
    ];
    const browser = createHelpBrowser([...commands, { data }], categories, {
        prefix: "bauaa:help:",
        title: "BauaaCore Command Guide",
        description: "Choose a category, then open a command to see its usage, options, and subcommands.",
    });
    return {
        data,
        matches: browser.matches,
        component: browser.component,
        execute(interaction) {
            const payload = browser.open(interaction.user.id);
            return interaction.reply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
        },
    };
}

module.exports = { createHelpCommand };
