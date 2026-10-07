const { EmbedBuilder } = require("discord.js");
const { sendAllLog } = require("../utils/allLogger");

module.exports = {
    name: "messageDelete",

    async execute(message) {
        console.log("🗑️ messageDelete event received");

        // Ignore bot messages
        if (message.author?.bot) {
            console.log("⏭️ Ignored bot message");
            return;
        }

        // Ignore DMs
        if (!message.guild) {
            console.log("⏭️ Ignored DM");
            return;
        }

        console.log(`👤 User: ${message.author.tag}`);
        console.log(`📍 Channel: ${message.channel.name}`);

        const logChannel = message.guild.channels.cache.find(
            channel => channel.name === "deleted-msg-logs"
        );

        if (!logChannel) {
            console.log("❌ deleted-msg-logs channel not found");
            return;
        }

        console.log(`✅ Log channel found: ${logChannel.name}`);

        const content = message.content?.trim() || "*No text content*";

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
                `${message.author} \`${message.author.tag}\`\n\n` +

                `📍 **Channel**\n` +
                `${message.channel}\n\n` +

                `🆔 **Channel ID**\n` +
                `\`${message.channel.id}\`\n\n` +

                `💬 **Deleted Message**\n` +
                `> ${content.substring(0, 1000)}`
            )
            .addFields({
                name: "🆔 Message ID",
                value: `\`${message.id}\``,
                inline: false,
            })
            .setFooter({
                text: `BauaaCore • ${deletedAt} IST`,
            });

            await logChannel.send({
                embeds: [embed],
            });

            await sendAllLog({
                guild: message.guild,
                title: "🗑️ Message Deleted",
                description:
                    `👤 **User**\n${message.author} \`${message.author.tag}\`\n\n` +
                    `📍 **Channel**\n${message.channel}`,
                color: 0xED4245,
            });

            console.log("✅ Deleted message logs sent!");
    },
};