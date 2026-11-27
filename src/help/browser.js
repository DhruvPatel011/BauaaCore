const { createHash } = require("node:crypto");
const {
    ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, ContainerBuilder,
    MessageFlags, SeparatorBuilder, SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder,
} = require("discord.js");

const GUIDE_URL = "https://github.com/DhruvPatel011/BauaaCore#";
const noMentions = { parse: [], repliedUser: false };
const { Subcommand, SubcommandGroup } = ApplicationCommandOptionType;

function usage(node) {
    if (node.children.length) return `${node.title} <subcommand>`;
    const args = node.options.map(option => {
        const type = ApplicationCommandOptionType[option.type].toLowerCase();
        const value = { string: "text", boolean: "true|false", attachment: "file" }[type] ?? type;
        const argument = `${option.name}:<${value}>`;
        return option.required ? argument : `[${argument}]`;
    });
    return [node.title, ...args].join(" ");
}

function optionDetails(options) {
    return options.map(option => {
        const required = option.required ? "required" : "optional";
        const choices = option.choices?.map(choice => choice.name).join(", ");
        return `- \`${option.name}\` (${required}) · ${option.description}${choices ? ` Choices: ${choices}.` : ""}`;
    }).join("\n");
}

function createHelpBrowser(commands, categories, { prefix, title, description, anchor = "commands" }) {
    const nodes = new Map();
    const remaining = new Map(commands.map(({ data }) => [data.name, data.toJSON()]));

    function addNode(key, details) {
        const id = createHash("sha256").update(key).digest("hex").slice(0, 16);
        const node = { id, children: [], ...details };
        nodes.set(id, node);
        return node;
    }

    const home = addNode("home", { title, description, anchor });

    function addCommand(definition, parent, path = `/${definition.name}`) {
        const options = definition.options ?? [];
        const branches = options.filter(option => option.type === Subcommand || option.type === SubcommandGroup);
        const node = addNode(path, {
            title: path, description: definition.description, anchor: parent.anchor,
            parent, options: branches.length ? [] : options,
        });
        node.children = branches.map(option => addCommand(option, node, `${path} ${option.name}`));
        return node;
    }

    function addCategory([name, summary, docs, names]) {
        const category = addNode(name, { title: name, description: summary, anchor: docs, parent: home });
        for (const name of names) {
            if (!remaining.has(name)) continue;
            category.children.push(addCommand(remaining.get(name), category));
            remaining.delete(name);
        }
        if (category.children.length) home.children.push(category);
    }

    categories.forEach(addCategory);
    if (remaining.size) addCategory(["More commands", "Browse other BauaaCore commands.", anchor, [...remaining.keys()]]);

    function render(node, userId) {
        const customId = target => `${prefix}${userId}:${target.id}`;
        const card = new ContainerBuilder().setAccentColor(0x8B5CF6);
        const heading = [
            `## ${node.options ? `\`${node.title}\`` : node.title}`,
            node.options && `-# Usage: \`${usage(node)}\``,
            node.description,
        ].filter(Boolean).join("\n");
        card.addTextDisplayComponents(new TextDisplayBuilder().setContent(heading));

        if (node.options?.length) {
            card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Options**\n${optionDetails(node.options)}`));
        }
        card.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

        if (node.children.length) {
            const placeholder = node === home ? "Choose a category" : node.options ? "Choose a subcommand" : "Choose a command";
            const menu = new StringSelectMenuBuilder().setCustomId(customId(node)).setPlaceholder(placeholder)
                .addOptions(node.children.map(child => ({
                    label: node.options ? child.title.split(" ").at(-1) : child.title,
                    description: child.description,
                    value: child.id,
                })));
            card.addActionRowComponents(new ActionRowBuilder().addComponents(menu));
        }

        const buttons = [];
        const parent = node.parent;
        if (parent && parent !== home && (parent.options || parent.children.length > 1)) {
            buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel(`Back to ${parent.title}`).setCustomId(customId(parent)));
        }
        if (parent) {
            buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Secondary).setLabel("All categories").setCustomId(customId(home)));
        }
        buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Command guide").setURL(`${GUIDE_URL}${node.anchor}`));
        card.addActionRowComponents(new ActionRowBuilder().addComponents(buttons));
        return { components: [card], allowedMentions: noMentions };
    }

    function reply(interaction, content) {
        return interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: noMentions });
    }

    async function component(interaction) {
        const [userId, id] = interaction.customId.slice(prefix.length).split(":");
        if (interaction.user.id !== userId) return reply(interaction, "Open your own command guide with `/help`.");
        let target = nodes.get(id);
        if (interaction.isStringSelectMenu()) {
            const selected = target?.children.find(child => child.id === interaction.values[0]);
            target = target === home && selected?.children.length === 1 ? selected.children[0] : selected;
        }
        if (!target) return reply(interaction, "This menu is out of date. Open a new command guide with `/help`.");
        return interaction.update(render(target, userId));
    }

    return {
        open: userId => ({ ...render(home, userId), flags: MessageFlags.IsComponentsV2 }),
        matches: customId => customId?.startsWith(prefix),
        component,
    };
}

module.exports = { createHelpBrowser };
