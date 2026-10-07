const { sendAllLog } = require("../utils/allLogger");

const {
    EmbedBuilder,
    AuditLogEvent,
} = require("discord.js");

function getTime(date = new Date()) {
    return new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    }).format(date);
}

function getDuration(durationMs) {
    const totalSeconds = Math.max(
        0,
        Math.floor(durationMs / 1000)
    );

    const days = Math.floor(totalSeconds / 86400);

    const hours = Math.floor(
        (totalSeconds % 86400) / 3600
    );

    const minutes = Math.floor(
        (totalSeconds % 3600) / 60
    );

    const seconds = totalSeconds % 60;

    const parts = [];

    if (days > 0) {
        parts.push(
            `${days} day${days !== 1 ? "s" : ""}`
        );
    }

    if (hours > 0) {
        parts.push(
            `${hours} hour${hours !== 1 ? "s" : ""}`
        );
    }

    if (minutes > 0) {
        parts.push(
            `${minutes} minute${minutes !== 1 ? "s" : ""}`
        );
    }

    if (seconds > 0 && parts.length === 0) {
        parts.push(
            `${seconds} second${seconds !== 1 ? "s" : ""}`
        );
    }

    return parts.join(" ") || "Less than 1 second";
}

async function getAuditExecutor(
    guild,
    type,
    targetId,
    changeKey = null
) {
    try {
        const auditLogs = await guild.fetchAuditLogs({
            type,
            limit: 10,
        });

        const entry = auditLogs.entries.find(entry => {
            if (entry.target?.id !== targetId) {
                return false;
            }

            if (
                Date.now() - entry.createdTimestamp >
                10000
            ) {
                return false;
            }

            if (
                changeKey &&
                !entry.changes?.some(
                    change => change.key === changeKey
                )
            ) {
                return false;
            }

            return true;
        });

        if (!entry) {
            return {
                executor: "Unknown",
                reason: "No reason provided",
            };
        }

        return {
            executor: entry.executor
                ? `${entry.executor} \`${entry.executor.tag}\``
                : "Unknown",

            reason:
                entry.reason ||
                "No reason provided",
        };
    } catch (error) {
        console.error(
            "❌ Audit Log Error:",
            error
        );

        return {
            executor: "Unknown",
            reason: "No reason provided",
        };
    }
}

module.exports = {
    name: "guildMemberUpdate",

    async execute(oldMember, newMember) {

        // ==================================================
        // CHANNELS
        // ==================================================

        const roleLogChannel =
            newMember.guild.channels.cache.find(
                channel =>
                    channel.name === "role-logs"
            );

        const moderationLogChannel =
            newMember.guild.channels.cache.find(
                channel =>
                    channel.name === "kick-ban-logs"
            );

        // ==================================================
        // TIMEOUT DETECTION
        // ==================================================

        const oldTimeout =
            oldMember.communicationDisabledUntilTimestamp;

        const newTimeout =
            newMember.communicationDisabledUntilTimestamp;

        // ==================================================
        // ROLE DETECTION
        // ==================================================

        const oldRoles = new Set(
            oldMember.roles.cache.keys()
        );

        const newRoles = new Set(
            newMember.roles.cache.keys()
        );

        const addedRoles = newMember.roles.cache.filter(
            role => !oldRoles.has(role.id)
        );

        const removedRoles = oldMember.roles.cache.filter(
            role => !newRoles.has(role.id)
        );

        // ==================================================
        // TIMEOUT STARTED
        // ==================================================

        if (
            oldTimeout !== newTimeout &&
            !oldTimeout &&
            newTimeout
        ) {
            if (!moderationLogChannel) {
                console.log(
                    "❌ kick-ban-logs channel not found"
                );
            } else {
                const audit = await getAuditExecutor(
                    newMember.guild,
                    AuditLogEvent.MemberUpdate,
                    newMember.id,
                    "communication_disabled_until"
                );

                const timeoutUntil =
                    getTime(new Date(newTimeout));

                const durationMs =
                    newTimeout - Date.now();

                const duration =
                    getDuration(durationMs);

                const embed = new EmbedBuilder()
                    .setColor(0xF1C40F)
                    .setTitle("⏱️ Member Timed Out")
                    .setThumbnail(
                        newMember.user.displayAvatarURL({
                            size: 256,
                        })
                    )
                    .setDescription(
                        `👤 **User**\n` +
                        `${newMember.user} \`${newMember.user.tag}\`\n\n` +

                        `🆔 **User ID**\n` +
                        `\`${newMember.id}\`\n\n` +

                        `🛡️ **Timed Out By**\n` +
                        `${audit.executor}\n\n` +

                        `⏳ **Duration**\n` +
                        `${duration}\n\n` +

                        `🕐 **Timeout Until**\n` +
                        `${timeoutUntil} IST\n\n` +

                        `📝 **Reason**\n` +
                        `${audit.reason}`
                    )
                    .setFooter({
                        text: `BauaaCore • Timeout at ${getTime()} IST`,
                    });

                // Detailed moderation log
                await moderationLogChannel.send({
                    embeds: [embed],
                });

                // Short all-logs entry
                await sendAllLog({
                    guild: newMember.guild,
                    title: "⏱️ Member Timed Out",
                    description:
                        `👤 **User**\n${newMember.user}\n\n` +
                        `🛡️ **Timed Out By**\n${audit.executor}\n\n` +
                        `⏳ **Duration**\n${duration}`,
                    color: 0xF1C40F,
                });

                console.log(
                    `⏱️ Timeout: ${newMember.user.tag} for ${duration}`
                );
            }
        }

        // ==================================================
        // TIMEOUT REMOVED
        // ==================================================

        if (
            oldTimeout &&
            !newTimeout
        ) {
            if (!moderationLogChannel) {
                console.log(
                    "❌ kick-ban-logs channel not found"
                );
            } else {
                const audit = await getAuditExecutor(
                    newMember.guild,
                    AuditLogEvent.MemberUpdate,
                    newMember.id,
                    "communication_disabled_until"
                );

                const embed = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle("🔓 Timeout Removed")
                    .setThumbnail(
                        newMember.user.displayAvatarURL({
                            size: 256,
                        })
                    )
                    .setDescription(
                        `👤 **User**\n` +
                        `${newMember.user} \`${newMember.user.tag}\`\n\n` +

                        `🆔 **User ID**\n` +
                        `\`${newMember.id}\`\n\n` +

                        `🛡️ **Removed By**\n` +
                        `${audit.executor}\n\n` +

                        `📝 **Reason**\n` +
                        `${audit.reason}`
                    )
                    .setFooter({
                        text: `BauaaCore • Timeout removed at ${getTime()} IST`,
                    });

                // Detailed moderation log
                await moderationLogChannel.send({
                    embeds: [embed],
                });

                // Short all-logs entry
                await sendAllLog({
                    guild: newMember.guild,
                    title: "🔓 Timeout Removed",
                    description:
                        `👤 **User**\n${newMember.user}\n\n` +
                        `🛡️ **Removed By**\n${audit.executor}`,
                    color: 0x57F287,
                });

                console.log(
                    `🔓 Timeout removed: ${newMember.user.tag}`
                );
            }
        }

        // ==================================================
        // ROLE ADDED
        // ==================================================

        if (
            addedRoles.size > 0 &&
            roleLogChannel
        ) {
            const audit = await getAuditExecutor(
                newMember.guild,
                AuditLogEvent.MemberRoleUpdate,
                newMember.id
            );

            for (const role of addedRoles.values()) {

                // Ignore @everyone
                if (role.id === newMember.guild.id) {
                    continue;
                }

                const embed = new EmbedBuilder()
                    .setColor(0x57F287)
                    .setTitle("➕ Role Added")
                    .setThumbnail(
                        newMember.user.displayAvatarURL({
                            size: 256,
                        })
                    )
                    .setDescription(
                        `👤 **Member**\n` +
                        `${newMember.user} \`${newMember.user.tag}\`\n\n` +

                        `🎭 **Role**\n` +
                        `${role}\n\n` +

                        `🛡️ **Added By**\n` +
                        `${audit.executor}\n\n` +

                        `🆔 **Member ID**\n` +
                        `\`${newMember.id}\`\n\n` +

                        `🆔 **Role ID**\n` +
                        `\`${role.id}\`\n\n` +

                        `📝 **Reason**\n` +
                        `${audit.reason}`
                    )
                    .setFooter({
                        text: `BauaaCore • Role added at ${getTime()} IST`,
                    });

                // Detailed role log
                await roleLogChannel.send({
                    embeds: [embed],
                });

                // Short all-logs entry
                await sendAllLog({
                    guild: newMember.guild,
                    title: "➕ Role Added",
                    description:
                        `👤 **Member**\n${newMember.user}\n\n` +
                        `🎭 **Role**\n${role}\n\n` +
                        `🛡️ **Added By**\n${audit.executor}`,
                    color: 0x57F287,
                });

                console.log(
                    `➕ Role added: ${role.name} → ${newMember.user.tag}`
                );
            }
        }

        // ==================================================
        // ROLE REMOVED
        // ==================================================

        if (
            removedRoles.size > 0 &&
            roleLogChannel
        ) {
            const audit = await getAuditExecutor(
                newMember.guild,
                AuditLogEvent.MemberRoleUpdate,
                newMember.id
            );

            for (const role of removedRoles.values()) {

                // Ignore @everyone
                if (role.id === newMember.guild.id) {
                    continue;
                }

                const embed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle("➖ Role Removed")
                    .setThumbnail(
                        newMember.user.displayAvatarURL({
                            size: 256,
                        })
                    )
                    .setDescription(
                        `👤 **Member**\n` +
                        `${newMember.user} \`${newMember.user.tag}\`\n\n` +

                        `🎭 **Role**\n` +
                        `${role.name}\n\n` +

                        `🛡️ **Removed By**\n` +
                        `${audit.executor}\n\n` +

                        `🆔 **Member ID**\n` +
                        `\`${newMember.id}\`\n\n` +

                        `🆔 **Role ID**\n` +
                        `\`${role.id}\`\n\n` +

                        `📝 **Reason**\n` +
                        `${audit.reason}`
                    )
                    .setFooter({
                        text: `BauaaCore • Role removed at ${getTime()} IST`,
                    });

                // Detailed role log
                await roleLogChannel.send({
                    embeds: [embed],
                });

                // Short all-logs entry
                await sendAllLog({
                    guild: newMember.guild,
                    title: "➖ Role Removed",
                    description:
                        `👤 **Member**\n${newMember.user}\n\n` +
                        `🎭 **Role**\n${role.name}\n\n` +
                        `🛡️ **Removed By**\n${audit.executor}`,
                    color: 0xED4245,
                });

                console.log(
                    `➖ Role removed: ${role.name} ← ${newMember.user.tag}`
                );
            }
        }
    },
};