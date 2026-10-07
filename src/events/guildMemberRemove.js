const { sendAllLog } = require("../utils/allLogger");

const {
    EmbedBuilder,
    AuditLogEvent,
} = require("discord.js");

module.exports = {
    name: "guildMemberRemove",

    async execute(member) {
        const guild = member.guild;

        const botLogChannel =
            guild.channels.cache.find(
                channel =>
                    channel.name === "main-bots-logs"
            );

        const moderationLogChannel =
            guild.channels.cache.find(
                channel =>
                    channel.name === "kick-ban-logs"
            );

        const memberLogChannel =
            guild.channels.cache.find(
                channel =>
                    channel.name === "members-log"
            );

        // ==================================================
        // BOT REMOVED
        // ==================================================

        if (member.user.bot) {
            if (!botLogChannel) {
                console.log(
                    "❌ main-bots-logs channel not found"
                );
                return;
            }

            let isKick = false;
            let executor = "Unknown";
            let reason = "No reason provided";

            try {
                const auditLogs =
                    await guild.fetchAuditLogs({
                        type: AuditLogEvent.MemberKick,
                        limit: 10,
                    });

                const entry = auditLogs.entries.find(
                    entry =>
                        entry.target?.id === member.id &&
                        Date.now() -
                            entry.createdTimestamp <
                            10000
                );

                if (entry) {
                    isKick = true;

                    if (entry.executor) {
                        executor =
                            `${entry.executor} \`${entry.executor.tag}\``;
                    }

                    reason =
                        entry.reason ||
                        "No reason provided";
                }
            } catch (error) {
                console.error(
                    "❌ Bot Remove Audit Log Error:",
                    error
                );
            }

            const removedAt = new Intl.DateTimeFormat(
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
                .setColor(
                    isKick
                        ? 0xE67E22
                        : 0xED4245
                )
                .setTitle(
                    isKick
                        ? "👢 Bot Kicked"
                        : "🚪 Bot Removed"
                )
                .setThumbnail(
                    member.user.displayAvatarURL({
                        size: 256,
                    })
                )
                .setDescription(
                    `🤖 **Bot**\n` +
                    `${member.user} \`${member.user.tag}\`\n\n` +

                    `🆔 **Bot ID**\n` +
                    `\`${member.id}\`\n\n` +

                    `🛡️ **${isKick ? "Kicked" : "Removed"} By**\n` +
                    `${executor}\n\n` +

                    `📅 **Account Created**\n` +
                    `${accountCreated}\n\n` +

                    `📝 **Reason**\n` +
                    `${reason}\n\n` +

                    `🕐 **Removed At**\n` +
                    `${removedAt} IST`
                )
                .setFooter({
                    text: "BauaaCore • Bot Logs",
                });

                await sendAllLog({
                    guild,
                    title: isKick ? "👢 Bot Kicked" : "🚪 Bot Removed",
                    description:
                        `🤖 **Bot**\n${member.user}\n\n` +
                        `🛡️ **${isKick ? "Kicked" : "Removed"} By**\n${executor}`,
                    color: isKick ? 0xE67E22 : 0xED4245,
                });

            console.log(
                `🤖 Bot removed: ${member.user.tag}`
            );

            return;
        }

        // ==================================================
        // CHECK KICK FOR NORMAL MEMBER
        // ==================================================

        let isKick = false;
        let executor = "Unknown";
        let reason = "No reason provided";

        try {
            const auditLogs =
                await guild.fetchAuditLogs({
                    type: AuditLogEvent.MemberKick,
                    limit: 10,
                });

            const entry = auditLogs.entries.find(
                entry =>
                    entry.target?.id === member.id &&
                    Date.now() -
                        entry.createdTimestamp <
                        10000
            );

            if (entry) {
                isKick = true;

                if (entry.executor) {
                    executor =
                        `${entry.executor} \`${entry.executor.tag}\``;
                }

                reason =
                    entry.reason ||
                    "No reason provided";
            }
        } catch (error) {
            console.error(
                "❌ Kick Audit Log Error:",
                error
            );
        }

        // ==================================================
        // NORMAL MEMBER KICK
        // ==================================================

        if (isKick) {
            if (!moderationLogChannel) {
                console.log(
                    "❌ kick-ban-logs channel not found"
                );
                return;
            }

            const kickedAt = new Intl.DateTimeFormat(
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

            const embed = new EmbedBuilder()
                .setColor(0xE67E22)
                .setTitle("👢 Member Kicked")
                .setThumbnail(
                    member.user.displayAvatarURL({
                        size: 256,
                    })
                )
                .setDescription(
                    `👤 **User**\n` +
                    `${member.user} \`${member.user.tag}\`\n\n` +

                    `🆔 **User ID**\n` +
                    `\`${member.id}\`\n\n` +

                    `🛡️ **Kicked By**\n` +
                    `${executor}\n\n` +

                    `📝 **Reason**\n` +
                    `${reason}`
                )
                .setFooter({
                    text: `BauaaCore • Kicked at ${kickedAt} IST`,
                });

                await sendAllLog({
                    guild,
                    title: "👢 Member Kicked",
                    description:
                        `👤 **User**\n${member.user}\n\n` +
                        `🛡️ **Kicked By**\n${executor}`,
                    color: 0xE67E22,
                });

            console.log(
                `👢 Member kicked: ${member.user.tag}`
            );

            return;
        }

        // ==================================================
        // NORMAL MEMBER LEAVE
        // ==================================================

        if (!memberLogChannel) {
            console.log(
                "❌ members-log channel not found"
            );
            return;
        }

        const leftAt = new Intl.DateTimeFormat(
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

        const joinedAt = member.joinedAt
            ? new Intl.DateTimeFormat(
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
              ).format(member.joinedAt)
            : "Unknown";

        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle("📤 Member Left")
            .setThumbnail(
                member.user.displayAvatarURL({
                    size: 256,
                })
            )
            .setDescription(
                `👤 **User**\n` +
                `${member.user.tag}\n\n` +

                `🆔 **User ID**\n` +
                `\`${member.id}\`\n\n` +

                `📅 **Joined Server**\n` +
                `${joinedAt} IST\n\n` +

                `🕐 **Left Server**\n` +
                `${leftAt} IST`
            )
            .setFooter({
                text: "BauaaCore • Member Logs",
            });

            await sendAllLog({
                guild,
                title: "📤 Member Left",
                description:
                    `👤 **User**\n${member.user}`,
                color: 0xED4245,
            });

        console.log(
            `📤 Member left: ${member.user.tag}`
        );
    },
};