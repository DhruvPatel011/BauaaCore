
const { EmbedBuilder } = require("discord.js");
const { sendAllLog } = require("../utils/allLogger");
const { sendConfiguredLog } = require("../utils/logger");
const { getDatabase } = require("../config/database");
const { isIgnored } = require("../utils/ignoreManager");
const { claimVoiceTransition } = require("../utils/logEvents");

const pendingUpdates = new Map();

// ========================================
// TIME HELPERS
// ========================================

function getDuration(startTime, endTime) {
    const start = new Date(startTime).getTime();

    if (!Number.isFinite(start)) {
        return "Unknown";
    }

    const durationMs = Math.max(0, endTime.getTime() - start);
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

function getTime(date) {
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
    embed,
    title,
    description,
    color,
}) {
    const [voiceResult] = await Promise.allSettled([
        sendConfiguredLog(guild, "voice", { embeds: [embed] }),
        sendAllLog({ guild, title, description, color }),
    ]);
    if (voiceResult.status === "rejected") {
        console.error(`❌ Voice log delivery failed in guild ${guild.id}:`, voiceResult.reason);
    }
}

// ========================================
// MAIN EVENT
// ========================================

async function logVoiceUpdate({
    guild, userId, cachedUser, oldChannelId, newChannelId, oldChannelName, newChannelName,
    sessionId, muteChanged, serverMute, deafChanged, serverDeaf, occurredAt,
}) {
    if (await isIgnored(guild.id, userId)) {
        console.log(`⏭️ Voice logs ignored for ID ${userId} in guild ${guild.id}`);
        return;
    }

    // Discord may omit the member from a voice-state update.
    const user = cachedUser || await guild.client.users.fetch(userId);
    const changedChannel = oldChannelId !== newChannelId;
    if (changedChannel) {
        if (user.bot) return;
        if (!(await claimVoiceTransition(guild.id, userId, sessionId, oldChannelId, newChannelId))) return;
    }

    const mention = `<@${userId}>`;
    const oldChannel = oldChannelId ? `<#${oldChannelId}>` : null;
    const newChannel = newChannelId ? `<#${newChannelId}>` : null;
    const sessions = getVoiceSessions();
    const sessionKey = { guildId: guild.id, userId };

    // ========================================
    // JOIN
    // ========================================

    if (!oldChannel && newChannel) {
        const joinedAt = occurredAt;

        await sessions.updateOne(
            sessionKey,
            {
                $set: {
                    guildId: guild.id,
                    userId: user.id,
                    channelId: newChannelId,
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
                `${mention} \`${user.tag}\`\n\n` +

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
            embed,
            title: "🟢 Voice Channel Joined",
            description:
                `👤 **User**\n${mention}\n\n` +
                `📍 **Channel**\n${newChannel}`,
            color: 0x57F287,
        });

        console.log(
            `🟢 ${user.tag} joined ${newChannelName}`
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
            duration = getDuration(session.joinedAt, occurredAt);
        }

        // Remove completed session
        await sessions.deleteOne(sessionKey);

        const leftAt = occurredAt;

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
                `${mention} \`${user.tag}\`\n\n` +

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
            embed,
            title: "🔴 Voice Channel Left",
            description:
                `👤 **User**\n${mention}\n\n` +
                `📍 **Channel**\n${oldChannel}\n\n` +
                `⏱️ **Duration**\n${duration}`,
            color: 0xED4245,
        });

        console.log(
            `🔴 ${user.tag} left ${oldChannelName} • Duration: ${duration}`
        );

        return;
    }

    // ========================================
    // MOVE
    // ========================================

    if (changedChannel) {
        const session = await sessions.findOne(sessionKey);

        if (session) {
            // Preserve original join timestamp
            await sessions.updateOne(
                sessionKey,
                {
                    $set: {
                        channelId: newChannelId,
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
                        channelId: newChannelId,
                        joinedAt: occurredAt,
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
                `${mention} \`${user.tag}\`\n\n` +

                `📤 **From**\n` +
                `${oldChannel}\n\n` +

                `📥 **To**\n` +
                `${newChannel}\n\n` +

                `🆔 **User ID**\n` +
                `\`${user.id}\`\n\n` +

                `🕐 **Moved At**\n` +
                `${getTime(occurredAt)} IST`
            )
            .setFooter({
                text: "BauaaCore • Voice Logs",
            });

        await sendVoiceLog({
            guild,
            embed,
            title: "🔄 Voice Channel Moved",
            description:
                `👤 **User**\n${mention}\n\n` +
                `📤 **From**\n${oldChannel}\n\n` +
                `📥 **To**\n${newChannel}`,
            color: 0x5865F2,
        });

        console.log(
            `🔄 ${user.tag} moved: ${oldChannelName} → ${newChannelName}`
        );

        return;
    }

    // ========================================
    // SERVER MUTE
    // ========================================

    if (muteChanged && serverMute) {
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
                `${mention} \`${user.tag}\`\n\n` +

                `📍 **Channel**\n` +
                `${newChannel || oldChannel}\n\n` +

                `🆔 **User ID**\n` +
                `\`${user.id}\`\n\n` +

                `🕐 **Muted At**\n` +
                `${getTime(occurredAt)} IST`
            )
            .setFooter({
                text: "BauaaCore • Voice Logs",
            });

        await sendVoiceLog({
            guild,
            embed,
            title: "🔇 Member Server Muted",
            description:
                `👤 **User**\n${mention}\n\n` +
                `📍 **Channel**\n${newChannel || oldChannel}`,
            color: 0xF1C40F,
        });

        return;
    }

    // ========================================
    // SERVER UNMUTE
    // ========================================

    if (muteChanged) {
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
                `${mention} \`${user.tag}\`\n\n` +

                `📍 **Channel**\n` +
                `${newChannel || oldChannel}\n\n` +

                `🆔 **User ID**\n` +
                `\`${user.id}\`\n\n` +

                `🕐 **Unmuted At**\n` +
                `${getTime(occurredAt)} IST`
            )
            .setFooter({
                text: "BauaaCore • Voice Logs",
            });

        await sendVoiceLog({
            guild,
            embed,
            title: "🔊 Member Server Unmuted",
            description:
                `👤 **User**\n${mention}\n\n` +
                `📍 **Channel**\n${newChannel || oldChannel}`,
            color: 0x57F287,
        });

        return;
    }

    // ========================================
    // SERVER DEAFEN
    // ========================================

    if (deafChanged && serverDeaf) {
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
                `${mention} \`${user.tag}\`\n\n` +

                `📍 **Channel**\n` +
                `${newChannel || oldChannel}\n\n` +

                `🆔 **User ID**\n` +
                `\`${user.id}\`\n\n` +

                `🕐 **Deafened At**\n` +
                `${getTime(occurredAt)} IST`
            )
            .setFooter({
                text: "BauaaCore • Voice Logs",
            });

        await sendVoiceLog({
            guild,
            embed,
            title: "🔕 Member Server Deafened",
            description:
                `👤 **User**\n${mention}\n\n` +
                `📍 **Channel**\n${newChannel || oldChannel}`,
            color: 0xF1C40F,
        });

        return;
    }

    // ========================================
    // SERVER UNDEAFEN
    // ========================================

    if (deafChanged) {
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
                `${mention} \`${user.tag}\`\n\n` +

                `📍 **Channel**\n` +
                `${newChannel || oldChannel}\n\n` +

                `🆔 **User ID**\n` +
                `\`${user.id}\`\n\n` +

                `🕐 **Undeafened At**\n` +
                `${getTime(occurredAt)} IST`
            )
            .setFooter({
                text: "BauaaCore • Voice Logs",
            });

        await sendVoiceLog({
            guild,
            embed,
            title: "🔔 Member Server Undeafened",
            description:
                `👤 **User**\n${mention}\n\n` +
                `📍 **Channel**\n${newChannel || oldChannel}`,
            color: 0x57F287,
        });
    }
}

module.exports = {
    name: "voiceStateUpdate",

    async execute(oldState, newState) {
        const guild = newState.guild || oldState.guild;
        const cachedUser = newState.member?.user || oldState.member?.user;
        const userId = newState.id || oldState.id || cachedUser?.id;
        if (!guild || !userId) return;

        // discord.js can patch the new state in place when the next gateway event arrives.
        const oldChannel = oldState.channel;
        const newChannel = newState.channel;
        const oldChannelId = oldState.channelId ?? oldChannel?.id ?? null;
        const newChannelId = newState.channelId ?? newChannel?.id ?? null;
        const serverMute = Boolean(newState.serverMute);
        const serverDeaf = Boolean(newState.serverDeaf);
        const muteChanged = Boolean(oldState.serverMute) !== serverMute;
        const deafChanged = Boolean(oldState.serverDeaf) !== serverDeaf;
        if (oldChannelId === newChannelId && !muteChanged && !deafChanged) return;

        const update = {
            guild, userId, cachedUser, oldChannelId, newChannelId,
            oldChannelName: oldChannel?.name ?? oldChannelId,
            newChannelName: newChannel?.name ?? newChannelId,
            sessionId: (newChannelId ? newState : oldState).sessionId ?? null,
            muteChanged, serverMute, deafChanged, serverDeaf, occurredAt: new Date(),
        };
        const key = `${guild.id}:${userId}`;
        const previous = pendingUpdates.get(key) ?? Promise.resolve();
        const pending = previous.catch(() => {}).then(() => logVoiceUpdate(update));
        pendingUpdates.set(key, pending);
        try {
            await pending;
        } finally {
            if (pendingUpdates.get(key) === pending) pendingUpdates.delete(key);
        }
    },
};


