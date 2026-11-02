
const { EmbedBuilder } = require("discord.js");
const { isIgnored } = require("./ignoreManager");

async function sendAllLog({
    guild,
    title,
    description,
    color = 0x5865F2,
    ignoredUserId = null,
    ignoredWebhookId = null,
}) {
    try {
        if (!guild) return false;

        // Check ignored user or bot ID
        if (ignoredUserId) {
            const ignored = await isIgnored(
                guild.id,
                ignoredUserId
            );

            if (ignored) {
                console.log(
                    `⏭️ All log skipped: Ignored user ID ${ignoredUserId}`
                );
                return false;
            }
        }

        // Check ignored webhook ID
        if (ignoredWebhookId) {
            const ignored = await isIgnored(
                guild.id,
                ignoredWebhookId
            );

            if (ignored) {
                console.log(
                    `⏭️ All log skipped: Ignored webhook ID ${ignoredWebhookId}`
                );
                return false;
            }
        }

        // Find all-logs channel
        const logChannel = guild.channels.cache.find(
            channel =>
                channel.name === "all-logs" &&
                channel.isTextBased() &&
                typeof channel.send === "function"
        );

        if (!logChannel) {
            console.log("❌ all-logs channel not found");
            return false;
        }

        // Indian Standard Time
        const time = new Intl.DateTimeFormat("en-IN", {
            timeZone: "Asia/Kolkata",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        }).format(new Date());

        // Create embed
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .setFooter({
                text: `BauaaCore • ${time} IST`,
            });

        // Send log
        await logChannel.send({
            embeds: [embed],
            allowedMentions: {
                parse: [],
            },
        });

        return true;

    } catch (error) {
        console.error("❌ All Logger Error:", error);
        return false;
    }
}

module.exports = {
    sendAllLog,
};
