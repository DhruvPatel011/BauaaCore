
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
} = require("discord.js");

const {
    addIgnored,
    removeIgnored,
    listIgnored,
} = require("../utils/ignoreManager");

const ID_PATTERN = /^\d{17,20}$/;
const PAGE_SIZE = 15;

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ignore")
        .setDescription("Manage IDs excluded from BauaaCore logging.")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        .addSubcommand(subcommand =>
            subcommand
                .setName("add")
                .setDescription("Add a user, bot or webhook ID.")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("Type of ID")
                        .setRequired(true)
                        .addChoices(
                            { name: "User", value: "user" },
                            { name: "Bot", value: "bot" },
                            { name: "Webhook", value: "webhook" }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName("id")
                        .setDescription("Discord ID to ignore")
                        .setRequired(true)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName("remove")
                .setDescription("Remove an ID from ignore list.")
                .addStringOption(option =>
                    option
                        .setName("id")
                        .setDescription("Discord ID to remove")
                        .setRequired(true)
                )
        )

        .addSubcommand(subcommand =>
            subcommand
                .setName("list")
                .setDescription("Show ignored IDs in this server.")
                .addIntegerOption(option =>
                    option
                        .setName("page")
                        .setDescription("Page number (defaults to 1)")
                        .setMinValue(1)
                )
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: "❌ Use this command inside a server.",
                ephemeral: true,
            });
        }

        if (!interaction.memberPermissions?.has(
            PermissionFlagsBits.Administrator
        )) {
            return interaction.reply({
                content: "❌ Only administrators can use this command.",
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const action = interaction.options.getSubcommand();
        const guildId = interaction.guildId;

        try {
            if (action === "add") {
                const type = interaction.options.getString("type", true);
                const id = interaction.options.getString("id", true).trim();

                if (!ID_PATTERN.test(id)) {
                    return interaction.editReply(
                        "❌ Invalid Discord ID. Provide a valid 17–20 digit ID."
                    );
                }

                const result = await addIgnored(
                    guildId,
                    id,
                    type,
                    interaction.user.id
                );

                return interaction.editReply(
                    result.exists
                        ? `ℹ️ ID \`${id}\` is already ignored.`
                        : `✅ Added **${type}** ID \`${id}\` to the ignore list.`
                );
            }

            if (action === "remove") {
                const id = interaction.options.getString("id", true).trim();

                if (!ID_PATTERN.test(id)) {
                    return interaction.editReply(
                        "❌ Invalid Discord ID."
                    );
                }

                const removed = await removeIgnored(guildId, id);

                return interaction.editReply(
                    removed
                        ? `✅ Removed ID \`${id}\` from the ignore list.`
                        : `ℹ️ ID \`${id}\` was not found.`
                );
            }

            if (action === "list") {
                const page = interaction.options.getInteger("page") ?? 1;
                const { records, total, pageCount } = await listIgnored(guildId, page, PAGE_SIZE);

                if (total === 0) {
                    return interaction.editReply({
                        embeds: [
                            new EmbedBuilder()
                                .setColor(0xED4245)
                                .setTitle("🚫 BauaaCore • Ignore List")
                                .setDescription("No IDs are currently ignored.")
                                .setFooter({ text: "BauaaCore • Ignore Management" })
                                .setTimestamp(),
                        ],
                    });
                }

                if (page > pageCount) {
                    return interaction.editReply(`Choose a page from 1 to ${pageCount}.`);
                }

                const webhooks = records.some(record => record.type === "webhook")
                    ? await interaction.guild.fetchWebhooks().catch(() => null)
                    : null;

                const fields = await Promise.all(
                    records.map(async (record, index) => {
                        let name = "Unknown User";

                        if (record.type === "user" || record.type === "bot") {
                            try {
                                const user = await interaction.client.users.fetch(record.id);
                                name = user.globalName || user.username;
                            } catch {
                                name = "Unknown User";
                            }
                        }

                        if (record.type === "webhook") {
                            name = webhooks?.get(record.id)?.name || "Unknown Webhook";
                        }

                        return {
                            name: `${(page - 1) * PAGE_SIZE + index + 1}. ${record.type.toUpperCase()}`,
                            value:
                                `👤 **Name:** ${name}\n` +
                                `🆔 **ID:** \`${record.id}\`\n` +
                                `🔗 **Mention:** ${record.type !== "webhook" ? `<@${record.id}>` : "Not available"}`,
                            inline: false,
                        };
                    })
                );

                const embed = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle(`🚫 BauaaCore • Ignore List (${total})`)
                    .setDescription("These entities are excluded from supported logging events.")
                    .addFields(fields)
                    .setFooter({ text: `Page ${page} of ${pageCount} • Use /ignore list page:<number>` })
                    .setTimestamp();

                return interaction.editReply({ embeds: [embed] });
            }
        } catch (error) {
            console.error("❌ Ignore command error:", error);

            return interaction.editReply(
                action === "list" ? "❌ Could not load the ignore list." : "❌ Could not update the ignore list."
            );
        }
    },
};
