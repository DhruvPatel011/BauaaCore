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
    name: "channelCreate",

    async execute(channel) {
        if (!channel.guild) return;

        const logChannel = channel.guild.channels.cache.find(
            ch => ch.name === "channel-logs"
        );

        if (!logChannel) {
            console.log("❌ channel-logs channel not found");
            return;
        }

        const createdAt = new Intl.DateTimeFormat("en-IN", {
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
            .setColor(0x57F287)
            .setTitle("📁 Channel Created")
            .setDescription(
                `📌 **Channel**\n` +
                `${channel}\n\n` +

                `📝 **Name**\n` +
                `\`${channel.name}\`\n\n` +

                `📂 **Type**\n` +
                `${getChannelType(channel)}\n\n` +

                `🆔 **Channel ID**\n` +
                `\`${channel.id}\``
            )
            .setFooter({
                text: `BauaaCore • Created at ${createdAt} IST`,
            });

            await sendAllLog({
                guild: channel.guild,
                title: "📁 Channel Created",
                description:
                    `📌 **Channel**\n${channel}`,
                color: 0x57F287,
            });

        console.log(`📁 Channel created: ${channel.name}`);
    },
};