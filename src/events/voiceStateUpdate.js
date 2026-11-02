
const { EmbedBuilder } = require("discord.js");
const { sendAllLog } = require("../utils/allLogger");
const { getDatabase } = require("../config/database");

// ========================================
// TIME HELPERS
// ========================================

function getDuration(startTime) {
    const start = new Date(startTime).getTime();

    if (!Number.isFinite(start)) {
        return "Unknown";
    }

    const durationMs = Math.max(0, Date.now() - start);
    const totalSeconds = Math.floor(durationMs / 1000);

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];

    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);

    if (seconds > 0 || parts.length === 0) {
        parts.push(`${seconds}s`);
    }

    return parts.join(" ");
}

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

// ========================================
// DATABASE HELPER
// ========================================

function getVoiceSessions() {
    return getDatabase().collection("voice_sessions");
}

// ========================================
// LOGGING HELPER
// ========================================

async function sendVoiceLog({
    guild,
    logChannel,
    embed,
    title,
    description,
    color,
}) {
    // Dedicated voice log
    if (logChannel) {
        await logChannel.send({
            embeds: [embed],
        });
    }

    // All logs
    await sendAllLog({
        guild,
        title,
        description,
        color,
    });
}

// ========================================
// MAIN EVENT
// ========================================

module.exports = {
    name: "voiceStateUpdate",

    async execute(oldState, newState) {
        const guild = newState.guild || oldState.guild;

        if (!guild) return;

        const member = newState.member || oldState.member;

        if (!member || !member.user) return;

        const user = member.user;

        const oldChannel = oldState.channel;
        const newChannel = newState.channel;

        // Database
        const sessions = getVoiceSessions();

        // Voice log channel
        const logChannel = guild.channels.cache.find(
            channel => channel.name === "vc-logs"
        );

        const sessionKey = {
            guildId: guild.id,
            userId: user.id,
        };

        // ========================================
        // JOIN
        // ========================================

        if (!oldChannel && newChannel) {
            const joinedAt = new Date();

            await sessions.updateOne(
                sessionKey,
                {
                    $set: {
                        guildId: guild.id,
                        userId: user.id,
                        channelId: newChannel.id,
                        joinedAt,
                    },
                },
                {
                    upsert: true,
                }
            );

            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle("🟢 Voice Channel Joined")
                .setThumbnail(
                    user.displayAvatarURL({
                        size: 256,
                    })
                )
                .setDescription(
                    `👤 **User**\n` +
                    `${member} \`${user.tag}\`\n\n` +

                    `📍 **Channel**\n` +
                    `${newChannel}\n\n` +

                    `🆔 **User ID**\n` +
                    `\`${user.id}\`\n\n` +

                    `🕐 **Joined At**\n` +
                    `${getTime(joinedAt)} IST`
                )
                .setFooter({
                    text: "BauaaCore • Voice Logs",
                });

            await sendVoiceLog({
                guild,
                logChannel,
                embed,
                title: "🟢 Voice Channel Joined",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📍 **Channel**\n${newChannel}`,
                color: 0x57F287,
            });

            console.log(
                `🟢 ${user.tag} joined ${newChannel.name}`
            );

            return;
        }

        // ========================================
        // LEAVE
        // ========================================

        if (oldChannel && !newChannel) {
            const session = await sessions.findOne(sessionKey);

            let duration = "Unknown";

            if (session?.joinedAt) {
                duration = getDuration(session.joinedAt);
            }

            // Remove completed session
            await sessions.deleteOne(sessionKey);

            const leftAt = new Date();

            const embed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle("🔴 Voice Channel Left")
                .setThumbnail(
                    user.displayAvatarURL({
                        size: 256,
                    })
                )
                .setDescription(
                    `👤 **User**\n` +
                    `${member} \`${user.tag}\`\n\n` +

                    `📍 **Channel**\n` +
                    `${oldChannel}\n\n` +

                    `⏱️ **Duration**\n` +
                    `${duration}\n\n` +

                    `🆔 **User ID**\n` +
                    `\`${user.id}\`\n\n` +

                    `🕐 **Left At**\n` +
                    `${getTime(leftAt)} IST`
                )
                .setFooter({
                    text: "BauaaCore • Voice Logs",
                });

            await sendVoiceLog({
                guild,
                logChannel,
                embed,
                title: "🔴 Voice Channel Left",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📍 **Channel**\n${oldChannel}\n\n` +
                    `⏱️ **Duration**\n${duration}`,
                color: 0xED4245,
            });

            console.log(
                `🔴 ${user.tag} left ${oldChannel.name} • Duration: ${duration}`
            );

            return;
        }

        // ========================================
        // MOVE
        // ========================================

        if (
            oldChannel &&
            newChannel &&
            oldChannel.id !== newChannel.id
        ) {
            const session = await sessions.findOne(sessionKey);

            if (session) {
                // Preserve original join timestamp
                await sessions.updateOne(
                    sessionKey,
                    {
                        $set: {
                            channelId: newChannel.id,
                        },
                    }
                );
            } else {
                // No previous session available
                await sessions.updateOne(
                    sessionKey,
                    {
                        $set: {
                            guildId: guild.id,
                            userId: user.id,
                            channelId: newChannel.id,
                            joinedAt: new Date(),
                        },
                    },
                    {
                        upsert: true,
                    }
                );
            }

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle("🔄 Voice Channel Moved")
                .setThumbnail(
                    user.displayAvatarURL({
                        size: 256,
                    })
                )
                .setDescription(
                    `👤 **User**\n` +
                    `${member} \`${user.tag}\`\n\n` +

                    `📤 **From**\n` +
                    `${oldChannel}\n\n` +

                    `📥 **To**\n` +
                    `${newChannel}\n\n` +

                    `🆔 **User ID**\n` +
                    `\`${user.id}\`\n\n` +

                    `🕐 **Moved At**\n` +
                    `${getTime()} IST`
                )
                .setFooter({
                    text: "BauaaCore • Voice Logs",
                });

            await sendVoiceLog({
                guild,
                logChannel,
                embed,
                title: "🔄 Voice Channel Moved",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📤 **From**\n${oldChannel}\n\n` +
                    `📥 **To**\n${newChannel}`,
                color: 0x5865F2,
            });

            console.log(
                `🔄 ${user.tag} moved: ${oldChannel.name} → ${newChannel.name}`
            );

            return;
        }

        // ========================================
        // SERVER MUTE
        // ========================================

        if (
            !oldState.serverMute &&
            newState.serverMute
        ) {
            const embed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle("🔇 Member Server Muted")
                .setThumbnail(
                    user.displayAvatarURL({
                        size: 256,
                    })
                )
                .setDescription(
                    `👤 **User**\n` +
                    `${member} \`${user.tag}\`\n\n` +

                    `📍 **Channel**\n` +
                    `${newChannel || oldChannel}\n\n` +

                    `🆔 **User ID**\n` +
                    `\`${user.id}\`\n\n` +

                    `🕐 **Muted At**\n` +
                    `${getTime()} IST`
                )
                .setFooter({
                    text: "BauaaCore • Voice Logs",
                });

            await sendVoiceLog({
                guild,
                logChannel,
                embed,
                title: "🔇 Member Server Muted",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📍 **Channel**\n${newChannel || oldChannel}`,
                color: 0xF1C40F,
            });

            return;
        }

        // ========================================
        // SERVER UNMUTE
        // ========================================

        if (
            oldState.serverMute &&
            !newState.serverMute
        ) {
            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle("🔊 Member Server Unmuted")
                .setThumbnail(
                    user.displayAvatarURL({
                        size: 256,
                    })
                )
                .setDescription(
                    `👤 **User**\n` +
                    `${member} \`${user.tag}\`\n\n` +

                    `📍 **Channel**\n` +
                    `${newChannel || oldChannel}\n\n` +

                    `🆔 **User ID**\n` +
                    `\`${user.id}\`\n\n` +

                    `🕐 **Unmuted At**\n` +
                    `${getTime()} IST`
                )
                .setFooter({
                    text: "BauaaCore • Voice Logs",
                });

            await sendVoiceLog({
                guild,
                logChannel,
                embed,
                title: "🔊 Member Server Unmuted",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📍 **Channel**\n${newChannel || oldChannel}`,
                color: 0x57F287,
            });

            return;
        }

        // ========================================
        // SERVER DEAFEN
        // ========================================

        if (
            !oldState.serverDeaf &&
            newState.serverDeaf
        ) {
            const embed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle("🔕 Member Server Deafened")
                .setThumbnail(
                    user.displayAvatarURL({
                        size: 256,
                    })
                )
                .setDescription(
                    `👤 **User**\n` +
                    `${member} \`${user.tag}\`\n\n` +

                    `📍 **Channel**\n` +
                    `${newChannel || oldChannel}\n\n` +

                    `🆔 **User ID**\n` +
                    `\`${user.id}\`\n\n` +

                    `🕐 **Deafened At**\n` +
                    `${getTime()} IST`
                )
                .setFooter({
                    text: "BauaaCore • Voice Logs",
                });

            await sendVoiceLog({
                guild,
                logChannel,
                embed,
                title: "🔕 Member Server Deafened",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📍 **Channel**\n${newChannel || oldChannel}`,
                color: 0xF1C40F,
            });

            return;
        }

        // ========================================
        // SERVER UNDEAFEN
        // ========================================

        if (
            oldState.serverDeaf &&
            !newState.serverDeaf
        ) {
            const embed = new EmbedBuilder()
                .setColor(0x57F287)
                .setTitle("🔔 Member Server Undeafened")
                .setThumbnail(
                    user.displayAvatarURL({
                        size: 256,
                    })
                )
                .setDescription(
                    `👤 **User**\n` +
                    `${member} \`${user.tag}\`\n\n` +

                    `📍 **Channel**\n` +
                    `${newChannel || oldChannel}\n\n` +

                    `🆔 **User ID**\n` +
                    `\`${user.id}\`\n\n` +

                    `🕐 **Undeafened At**\n` +
                    `${getTime()} IST`
                )
                .setFooter({
                    text: "BauaaCore • Voice Logs",
                });

            await sendVoiceLog({
                guild,
                logChannel,
                embed,
                title: "🔔 Member Server Undeafened",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📍 **Channel**\n${newChannel || oldChannel}`,
                color: 0x57F287,
            });
        }
    },
};
