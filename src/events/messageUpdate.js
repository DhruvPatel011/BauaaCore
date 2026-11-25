const { EmbedBuilder } = require("discord.js");
const { sendAllLog } = require("../utils/allLogger");
const { getLogChannel, sendConfiguredLog } = require("../utils/logger");

module.exports = {
    name: "messageUpdate",

    async execute(oldMessage, newMessage) {
        // Ignore bot messages
        if (newMessage.author?.bot) return;

        // Ignore DMs
        if (!newMessage.guild) return;

        // Ignore messages where content did not actually change
        if (oldMessage.content === newMessage.content) return;

        const logChannel = await getLogChannel(newMessage.guild, "editedMessages");

        if (!logChannel) {
            return;
        }

        const before =
            oldMessage.content?.trim() || "*No content*";

        const after =
            newMessage.content?.trim() || "*No content*";

        const editedAt = new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        }).format(new Date());

        const embed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle("✏️ Message Edited")
            .setDescription(
                `👤 **User**\n` +
                `${newMessage.author} \`${newMessage.author.tag}\`\n\n` +

                `📍 **Channel**\n` +
                `${newMessage.channel}\n\n` +

                `📝 **Before**\n` +
                `> ${before.substring(0, 900)}\n\n` +

                `📝 **After**\n` +
                `> ${after.substring(0, 900)}`
            )
            .addFields({
                name: "🆔 Message ID",
                value: `\`${newMessage.id}\``,
            })
            .setFooter({
                text: `BauaaCore • Edited at ${editedAt} IST`,
            });

        // Detailed log
        await sendConfiguredLog(newMessage.guild, "editedMessages", {
            embeds: [embed],
        });

        // Short log in all-logs
        await sendAllLog({
            guild: newMessage.guild,
            title: "✏️ Message Edited",
            description:
                `👤 **User**\n${newMessage.author}\n\n` +
                `📍 **Channel**\n${newMessage.channel}`,
            color: 0xF1C40F,

            ignoredUserId: newMessage.author?.id,
            ignoredWebhookId: newMessage.webhookId,
        });

        console.log("✅ Edited message logs sent!");
    },
};