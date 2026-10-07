const { EmbedBuilder } = require("discord.js");

async function sendAllLog({
    guild,
    title,
    description,
    color = 0x5865F2,
}) {
    if (!guild) return;

    const logChannel = guild.channels.cache.find(
        channel => channel.name === "all-logs"
    );

    if (!logChannel) {
        console.log("❌ all-logs channel not found");
        return;
    }

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

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setFooter({
            text: `BauaaCore • ${time} IST`,
        });

    await logChannel.send({
        embeds: [embed],
    });
}

module.exports = {
    sendAllLog,
};