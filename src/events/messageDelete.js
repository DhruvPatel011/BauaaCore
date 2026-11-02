
const { EmbedBuilder } = require("discord.js");
const { sendAllLog } = require("../utils/allLogger");
const { isMessageIgnored } = require("../utils/ignoreManager");

module.exports = {
    name: "messageDelete",

    async execute(message) {
        try {
            if (!message.guild) return;

            // Check ignore list BEFORE sending any logs
            if (await isMessageIgnored(message)) {
                console.log(
                    `⏭️ Deleted message ignored: ${message.author?.tag || "Unknown"}`
                );
                return;
            }

            const logChannel = message.guild.channels.cache.find(
                channel => channel.name === "deleted-msg-logs"
            );

            if (!logChannel) return;

            const user = message.author
                ? `${message.author} \`${message.author.tag}\``
                : "Unknown User";

            const content =
                message.content?.trim() ||
                "*No text content available*";

            const deletedAt = new Intl.DateTimeFormat("en-IN", {
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
                .setColor(0xE74C3C)
                .setTitle("🗑️ Message Deleted")
                .setDescription(
                    `👤 **User**\n` +
                    `${user}\n\n` +
                    `📍 **Channel**\n` +
                    `${message.channel}\n\n` +
                    `💬 **Deleted Message**\n` +
                    `> ${content.substring(0, 1000)}`
                )
                .addFields(
                    {
                        name: "🆔 Message ID",
                        value: `\`${message.id}\``,
                        inline: true,
                    },
                    {
                        name: "🤖 Bot Message",
                        value: message.author?.bot ? "Yes" : "No",
                        inline: true,
                    }
                )
                .setFooter({
                    text: `BauaaCore • ${deletedAt} IST`,
                });

            // Dedicated log
            await logChannel.send({
                embeds: [embed],
            });

            // All logs
            await sendAllLog({
                guild: message.guild,
                title: "🗑️ Message Deleted",
                description:
                    `👤 **User**\n${user}\n\n` +
                    `📍 **Channel**\n${message.channel}`,
                color: 0xE74C3C,

                // Ignore protection
                ignoredUserId: message.author?.id,
                ignoredWebhookId: message.webhookId,
            });

            console.log(
                `✅ Deleted message logged from #${message.channel.name}`
            );
        } catch (error) {
            console.error("❌ Message Delete Log Error:", error);
        }
    },
};
