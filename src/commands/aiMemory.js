const { SlashCommandBuilder } = require("discord.js");

const memoryManager = require("../ai/memoryManager");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("ai-memory")
        .setDescription("View or manage what the AI remembers about you in this server.")
        .addSubcommand(sub =>
            sub.setName("list").setDescription("Show what the AI remembers about you.")
        )
        .addSubcommand(sub =>
            sub
                .setName("add")
                .setDescription("Ask the AI to remember something (no passwords, keys or sensitive info).")
                .addStringOption(option =>
                    option
                        .setName("text")
                        .setDescription("What should I remember?")
                        .setRequired(true)
                        .setMaxLength(300)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName("forget")
                .setDescription("Forget one memory by its number from /ai-memory list.")
                .addIntegerOption(option =>
                    option
                        .setName("number")
                        .setDescription("Memory number")
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(200)
                )
        )
        .addSubcommand(sub =>
            sub.setName("clear").setDescription("Delete everything the AI remembers about you.")
        ),

    async execute(interaction) {
        if (!interaction.guild) {
            return interaction.reply({
                content: "This command can only be used inside a server.",
                ephemeral: true,
            });
        }

        if (!memoryManager.isLongTermMemoryEnabled()) {
            return interaction.reply({
                content: "Long-term memory is turned off on this bot.",
                ephemeral: true,
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const guildId = interaction.guildId;
        const userId = interaction.user.id;

        try {
            const sub = interaction.options.getSubcommand();

            if (sub === "list") {
                const items = await memoryManager.listMemories(guildId, userId);

                if (!items.length) {
                    return interaction.editReply(
                        "I don't have anything saved about you. Use `/ai-memory add`, or say \"remember that ...\" in an AI channel."
                    );
                }

                const lines = items.map((item, index) => `**${index + 1}.** ${item.text}`);

                return interaction.editReply(
                    `**What I remember about you (this server only):**\n${lines.join("\n")}`.slice(0, 1900)
                );
            }

            if (sub === "add") {
                const result = await memoryManager.addMemory(
                    guildId,
                    userId,
                    interaction.options.getString("text", true),
                    { source: "command" }
                );

                return interaction.editReply(
                    result.ok
                        ? `Saved: **${result.text}**`
                        : `Not saved. ${result.message}`
                );
            }

            if (sub === "forget") {
                const result = await memoryManager.deleteMemoryByIndex(
                    guildId,
                    userId,
                    interaction.options.getInteger("number", true)
                );

                return interaction.editReply(
                    result.ok
                        ? `Forgot: **${result.text}**`
                        : "No memory with that number. Check `/ai-memory list`."
                );
            }

            if (sub === "clear") {
                const removed = await memoryManager.clearMemories(guildId, userId);

                return interaction.editReply(
                    removed
                        ? `Deleted ${removed} saved memor${removed === 1 ? "y" : "ies"}.`
                        : "You didn't have any saved memory."
                );
            }

            return interaction.editReply("Unknown subcommand.");

        } catch (error) {
            console.error("[AI Memory Error]", error);

            return interaction.editReply("Something went wrong while accessing your memory. Please try again.");
        }
    },
};
