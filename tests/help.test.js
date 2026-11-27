const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { ApplicationCommandOptionType, ComponentType, MessageFlags, SlashCommandBuilder } = require("discord.js");
const generalCommands = require("../src/commands");
const { createHelpCommand } = require("../src/commands/help");
const { installMusic } = require("../src/music/commands");

const user = { id: "555555555555555555" };

function frame(payload) {
    const components = payload.components[0].toJSON().components;
    const controls = components.flatMap(component => component.components ?? []);
    return {
        text: components.filter(item => item.type === ComponentType.TextDisplay).map(item => item.content).join("\n"),
        menu: controls.find(item => item.type === ComponentType.StringSelect),
        buttons: controls.filter(item => item.type === ComponentType.Button),
    };
}

async function click(command, component, value) {
    let updated;
    await command.component({ user, customId: component.custom_id, values: [value],
        isStringSelectMenu: () => component.type === ComponentType.StringSelect,
        async update(payload) { updated = frame(payload); } });
    return updated;
}

test("/help can browse every registered command and subcommand", async () => {
    const music = installMusic(new EventEmitter(), { enabled: false, env: {} });
    const commands = [...generalCommands, ...music.commands];
    const help = createHelpCommand(commands);
    const registered = [...commands, help].map(command => command.data.toJSON());
    assert.ok(registered.length <= 100);

    let home;
    await help.execute({ user, async reply(payload) {
        assert.equal(payload.flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
        home = frame(payload);
    } });
    assert.equal(home.menu.placeholder, "Choose a category");
    assert.ok(!home.menu.options.some(option => option.label === "More commands"));

    const visible = [];
    async function visit(view) {
        const path = /^## `(\/.+?)`$/m.exec(view.text)?.[1];
        if (path) visible.push(path);
        for (const option of view.menu?.options ?? []) await visit(await click(help, view.menu, option.value));
    }
    function paths(item, path = `/${item.name}`) {
        const subcommands = (item.options ?? []).filter(option => [
            ApplicationCommandOptionType.Subcommand, ApplicationCommandOptionType.SubcommandGroup,
        ].includes(option.type));
        return [path, ...subcommands.flatMap(option => paths(option, `${path} ${option.name}`))];
    }
    await visit(home);
    assert.deepEqual(visible.sort(), registered.flatMap(item => paths(item)).sort());

    const games = await click(help, home.menu, home.menu.options.find(option => option.label === "Games").value);
    assert.match(games.text, /`\/game <subcommand>`/);
    const tictactoe = await click(help, games.menu, games.menu.options.find(option => option.label === "tictactoe").value);
    assert.match(tictactoe.text, /`\/game tictactoe opponent:<user>`/);
    assert.match(tictactoe.text, /`opponent` \(required\)/);
    assert.deepEqual(await click(help, tictactoe.buttons.find(button => button.label === "Back to /game")), games);
    assert.deepEqual(await click(help, tictactoe.buttons.find(button => button.label === "All categories")), home);
    assert.match(tictactoe.buttons.find(button => button.label === "Command guide").url, /BauaaCore#games$/);
});

test("help supports nested groups and ignores navigation from another user", async () => {
    const definition = new SlashCommandBuilder().setName("sample").setDescription("Sample command.")
        .addSubcommandGroup(group => group.setName("channel").setDescription("Channel options.")
            .addSubcommand(sub => sub.setName("set").setDescription("Set the channel.")
                .addStringOption(option => option.setName("mode").setDescription("Choose the mode.")
                    .addChoices({ name: "Quiet", value: "quiet" }))));
    const help = createHelpCommand([{ data: definition }]);
    let home;
    await help.execute({ user, async reply(payload) { home = frame(payload); } });
    const option = home.menu.options.find(item => item.label === "More commands");
    const root = await click(help, home.menu, option.value);
    const group = await click(help, root.menu, root.menu.options[0].value);
    const leaf = await click(help, group.menu, group.menu.options[0].value);
    assert.match(leaf.text, /`\/sample channel set \[mode:<text>\]`/);
    assert.match(leaf.text, /`mode` \(optional\).*Choices: Quiet\./);
    assert.deepEqual(await click(help, leaf.buttons.find(button => button.label === "Back to /sample channel")), group);

    let denied;
    await help.component({ user: { id: "666666666666666666" }, customId: home.menu.custom_id, values: [option.value],
        isStringSelectMenu: () => true, async reply(payload) { denied = payload; } });
    assert.equal(denied.flags, MessageFlags.Ephemeral);
    assert.match(denied.content, /Open your own command guide/);
});
