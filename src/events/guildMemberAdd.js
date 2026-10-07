const { sendAllLog } = require("../utils/allLogger");

const {
    EmbedBuilder,
    AuditLogEvent,
} = require("discord.js");

module.exports = {
    name: "guildMemberAdd",

    async execute(member) {
        const guild = member.guild;

        // ==================================================
        // BOT JOIN
        // ==================================================

        if (member.user.bot) {
            const logChannel = guild.channels.cache.find(
                channel => channel.name === "main-bots-logs"
            );

            if (!logChannel) {
                console.log(
                    "❌ main-bots-logs channel not found"
                );
                return;
            }

            let executor = "Unknown";

            try {
                const auditLogs =
                    await guild.fetchAuditLogs({
                        type: AuditLogEvent.BotAdd,
                        limit: 10,
                    });

                const entry = auditLogs.entries.find(
                    entry =>
                        entry.target?.id === member.id &&
                        Date.now() -
                            entry.createdTimestamp <
                            10000
                );

                if (entry?.executor) {
                    executor =
                        `${entry.executor} \`${entry.executor.tag}\``;
                }
            } catch (error) {
                console.error(
                    "❌ Bot Add Audit Log Error:",
                    error
                );
            }

            const addedAt = new Intl.DateTimeFormat(
                "en-IN",
                {
                    timeZone: "Asia/Kolkata",
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: true,
                }
            ).format(new Date());

            const accountCreated =
                new Intl.DateTimeFormat("en-IN", {
                    timeZone: "Asia/Kolkata",
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                }).format(member.user.createdAt);

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("🤖 Bot Added")
                .setThumbnail(
                    member.user.displayAvatarURL({
                        size: 256,
                    })
                )
                .setDescription(
                    `🤖 **Bot**\n` +
                    `${member} \`${member.user.tag}\`\n\n` +

                    `🛡️ **Added By**\n` +
                    `${executor}\n\n` +

                    `🆔 **Bot ID**\n` +
                    `\`${member.id}\`\n\n` +

                    `📅 **Account Created**\n` +
                    `${accountCreated}\n\n` +

                    `🕐 **Added At**\n` +
                    `${addedAt} IST`
                )
                .setFooter({
                    text: "BauaaCore • Bot Logs",
                });

            // Detailed bot log
            await logChannel.send({
                embeds: [embed],
            });

            // Short all-logs entry
            await sendAllLog({
                guild,
                title: "🤖 Bot Added",
                description:
                    `🤖 **Bot**\n${member}\n\n` +
                    `🛡️ **Added By**\n${executor}`,
                color: 0x5865F2,
            });

            console.log(
                `🤖 Bot added: ${member.user.tag} by ${executor}`
            );

            return;
        }

        // ==================================================
        // NORMAL MEMBER JOIN
        // ==================================================

        const logChannel = guild.channels.cache.find(
            channel => channel.name === "members-log"
        );

        if (!logChannel) {
            console.log(
                "❌ members-log channel not found"
            );
            return;
        }

        const joinedAt = new Intl.DateTimeFormat(
            "en-IN",
            {
                timeZone: "Asia/Kolkata",
                day: "2-digit",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
            }
        ).format(new Date());

        const accountCreated =
            new Intl.DateTimeFormat("en-IN", {
                timeZone: "Asia/Kolkata",
                day: "2-digit",
                month: "short",
                year: "numeric",
            }).format(member.user.createdAt);

        const embed = new EmbedBuilder()
            .setColor(0x57F287)
            .setTitle("📥 Member Joined")
            .setThumbnail(
                member.user.displayAvatarURL({
                    size: 256,
                })
            )
            .setDescription(
                `👤 **User**\n` +
                `${member} \`${member.user.tag}\`\n\n` +

                `🆔 **User ID**\n` +
                `\`${member.id}\`\n\n` +

                `📅 **Account Created**\n` +
                `${accountCreated}\n\n` +

                `🕐 **Joined Server**\n` +
                `${joinedAt} IST`
            )
            .setFooter({
                text: "BauaaCore • Member Logs",
            });

        // Detailed member log
        await logChannel.send({
            embeds: [embed],
        });

        // Short all-logs entry
        await sendAllLog({
            guild,
            title: "📥 Member Joined",
            description:
                `👤 **User**\n${member}`,
            color: 0x57F287,
        });

        console.log(
            `📥 Member joined: ${member.user.tag}`
        );
    },
};