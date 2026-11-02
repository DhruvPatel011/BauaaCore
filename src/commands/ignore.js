const {
    SlashCommandBuilder,
    PermissionFlagsBits,
} = require("discord.js");

const {
    addIgnored,
    removeIgnored,
    listIgnored,
} = require("../utils/ignoreManager");

const ID_PATTERN = /^\\d{17,20}$/;

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ignore")
        .setDescription("Manage IDs excluded from BauaaCore logging.")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand
                .setName("add")
                .setDescription("Add a user, bot or webhook ID to the ignore list.")
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
                .setDescription("Remove an ID from the ignore list.")
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
                .setDescription("Show all ignored IDs in this server.")
        ),

    async execute(interaction) {
        if (!interaction.inGuild()) {
            return interaction.reply({
                content: "❌ This command can only be used inside a server.",
                ephemeral: true,
            });
        }

        if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({
                content: "❌ Only server administrators can use this command.",
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
                        "❌ Invalid Discord ID. Please provide a valid 17–20 digit ID."
                    );
                }

                const result = await addIgnored(
                    guildId,
                    id,
                    type,
                    interaction.user.id
                );

                if (result.exists) {
                    return interaction.editReply(
                        `ℹ️ ID \`${id}\` is already in this server's ignore list.`
                    );
                }

                return interaction.editReply(
                    `✅ Added **${type}** ID \`${id}\` to the ignore list. Related supported logs will be skipped.`
                );
            }

            if (action === "remove") {
                const id = interaction.options.getString("id", true).trim();

                if (!ID_PATTERN.test(id)) {
                    return interaction.editReply("❌ Please provide a valid 17–20 digit Discord ID.");
                }

                const removed = await removeIgnored(guildId, id);

                return interaction.editReply(
                    removed
                        ? `✅ Removed ID \`${id}\` from the ignore list.`
                        : `ℹ️ ID \`${id}\` was not found in the ignore list.`
                );
            }

            if (action === "list") {
                const records = await listIgnored(guildId);

                if (!records.length) {
                    return interaction.editReply("📭 No IDs are currently ignored in this server.");
                }

                const lines = records.slice(0, 40).map((record, index) =>
                    `**${index + 1}. ${record.type.toUpperCase()}** — \`${record.id}\``
                );

                const remaining = records.length - lines.length;
                if (remaining > 0) lines.push(`…and ${remaining} more.`);

                return interaction.editReply(
                    `**🚫 BauaaCore Ignore List (${records.length})**\\n\\n${lines.join("\\n")}`
                );
            }
        } catch (error) {
            console.error("❌ Ignore command error:", error);
            return interaction.editReply(
                "❌ Could not update the ignore list. Check MongoDB connection and try again."
            );
        }
    },
};
