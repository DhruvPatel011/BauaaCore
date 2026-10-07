const { EmbedBuilder } = require("discord.js");
const { sendAllLog } = require("../utils/allLogger");

// Store when each user joined a voice channel
const voiceSessions = new Map();

function getDuration(startTime) {
    const durationMs = Date.now() - startTime;

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

    // Show seconds only when duration is less than 1 minute
    if (seconds > 0 && parts.length === 0) {
        parts.push(
            `${seconds} second${seconds !== 1 ? "s" : ""}`
        );
    }

    return parts.join(" ") || "Less than 1 second";
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

module.exports = {
    name: "voiceStateUpdate",

    async execute(oldState, newState) {
        const guild = newState.guild || oldState.guild;

        if (!guild) return;

        const logChannel = guild.channels.cache.find(
            channel => channel.name === "vc-logs"
        );

        if (!logChannel) {
            console.log("❌ vc-logs channel not found");
            return;
        }

        const member = newState.member || oldState.member;

        if (!member) return;

        const user = member.user;

        const oldChannel = oldState.channel;
        const newChannel = newState.channel;

        // ==================================================
        // JOIN
        // ==================================================

        if (!oldChannel && newChannel) {
            voiceSessions.set(
                `${guild.id}-${user.id}`,
                {
                    channelId: newChannel.id,
                    joinedAt: Date.now(),
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
                    `${getTime()} IST`
                )
                .setFooter({
                    text: "BauaaCore • Voice Logs",
                });

            await sendAllLog({
                guild,
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

        // ==================================================
        // LEAVE
        // ==================================================

        if (oldChannel && !newChannel) {
            const sessionKey = `${guild.id}-${user.id}`;
            const session = voiceSessions.get(sessionKey);

            let duration = "Unknown";

            if (session) {
                duration = getDuration(session.joinedAt);
                voiceSessions.delete(sessionKey);
            }

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
                    `${getTime()} IST`
                )
                .setFooter({
                    text: "BauaaCore • Voice Logs",
                });

            await sendAllLog({
                guild,
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

        // ==================================================
        // MOVE
        // ==================================================

        if (
            oldChannel &&
            newChannel &&
            oldChannel.id !== newChannel.id
        ) {
            const sessionKey = `${guild.id}-${user.id}`;

            // Keep original join time
            if (!voiceSessions.has(sessionKey)) {
                voiceSessions.set(sessionKey, {
                    channelId: newChannel.id,
                    joinedAt: Date.now(),
                });
            } else {
                const session = voiceSessions.get(sessionKey);
                session.channelId = newChannel.id;
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

            await sendAllLog({
                guild,
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

        // ==================================================
        // SERVER MUTE
        // ==================================================

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

            await sendAllLog({
                guild,
                title: "🔇 Member Server Muted",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📍 **Channel**\n${newChannel || oldChannel}`,
                color: 0xF1C40F,
            });

            return;
        }

        // ==================================================
        // SERVER UNMUTE
        // ==================================================

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


            await sendAllLog({
                guild,
                title: "🔊 Member Server Unmuted",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📍 **Channel**\n${newChannel || oldChannel}`,
                color: 0x57F287,
            });

            return;
        }

        // ==================================================
        // SERVER DEAFEN
        // ==================================================

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

            await sendAllLog({
                guild,
                title: "🔕 Member Server Deafened",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📍 **Channel**\n${newChannel || oldChannel}`,
                color: 0xF1C40F,
            });

            return;
        }

        // ==================================================
        // SERVER UNDEAFEN
        // ==================================================

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

            await sendAllLog({
                guild,
                title: "🔔 Member Server Undeafened",
                description:
                    `👤 **User**\n${member}\n\n` +
                    `📍 **Channel**\n${newChannel || oldChannel}`,
                color: 0x57F287,
            });
        }
    },
};