
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js");

const {
    addIgnored,
    removeIgnored,
    listIgnored,
} = require("../utils/ignoreManager");

const ID_PATTERN = /^\d{17,20}$/;

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
                const records = await listIgnored(guildId);

                if (!records.length) {
                    return interaction.editReply(
                        "📭 No IDs are currently ignored."
                    );
                }

                const lines = records.slice(0, 40).map(
                    (record, index) =>
                        `**${index + 1}. ${record.type.toUpperCase()}** — \`${record.id}\``
                );

                if (records.length > 40) {
                    lines.push(`…and ${records.length - 40} more.`);
                }

                return interaction.editReply(
                    `**🚫 BauaaCore Ignore List (${records.length})**\n\n${lines.join("\n")}`
                );
            }
        } catch (error) {
            console.error("❌ Ignore command error:", error);

            return interaction.editReply(
                "❌ Could not update ignore list. Check MongoDB connection."
            );
        }
    },
};
