const { EmbedBuilder } = require("discord.js");
const { sendAllLog } = require("../utils/allLogger");

function getChannelType(channel) {
    switch (channel.type) {
        case 0:
            return "💬 Text Channel";

        case 2:
            return "🔊 Voice Channel";

        case 4:
            return "📁 Category";

        case 5:
            return "📢 Announcement Channel";

        case 10:
            return "🧵 Public Thread";

        case 11:
            return "🧵 Private Thread";

        case 12:
            return "🧵 Announcement Thread";

        case 13:
            return "🎤 Stage Channel";

        case 15:
            return "📝 Forum Channel";

        default:
            return "📌 Other Channel";
    }
}

module.exports = {
    name: "channelUpdate",

    async execute(oldChannel, newChannel) {
        if (!newChannel.guild) return;

        // Currently only log channel name changes
        if (oldChannel.name === newChannel.name) return;

        const logChannel = newChannel.guild.channels.cache.find(
            ch => ch.name === "channel-logs"
        );

        if (!logChannel) {
            console.log("❌ channel-logs channel not found");
            return;
        }

        const updatedAt = new Intl.DateTimeFormat("en-IN", {
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
            .setTitle("✏️ Channel Updated")
            .setDescription(
                `📌 **Channel**\n` +
                `${newChannel}\n\n` +

                `📝 **Before**\n` +
                `\`${oldChannel.name}\`\n\n` +

                `📝 **After**\n` +
                `\`${newChannel.name}\`\n\n` +

                `📂 **Type**\n` +
                `${getChannelType(newChannel)}\n\n` +

                `🆔 **Channel ID**\n` +
                `\`${newChannel.id}\``
            )
            .setFooter({
                text: `BauaaCore • Updated at ${updatedAt} IST`,
            });

            await sendAllLog({
                guild: newChannel.guild,
                title: "✏️ Channel Updated",
                description:
                    `📌 **Channel**\n${newChannel}\n\n` +
                    `📝 **Before**\n${oldChannel.name}\n\n` +
                    `📝 **After**\n${newChannel.name}`,
                color: 0xF1C40F,
            });

        console.log(
            `✏️ Channel renamed: ${oldChannel.name} → ${newChannel.name}`
        );
    },
};