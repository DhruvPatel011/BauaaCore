const {
    ChannelType,
    PermissionFlagsBits,
} = require("discord.js");

const logConfig = require("../config/logs");

async function setupLogging(guild) {
    // Find existing logging category
    let category = guild.channels.cache.find(
        channel =>
            channel.type === ChannelType.GuildCategory &&
            channel.name === logConfig.categoryName
    );

    // Create category if it doesn't exist
    if (!category) {
        category = await guild.channels.create({
            name: logConfig.categoryName,
            type: ChannelType.GuildCategory,

            permissionOverwrites: [
                {
                    // @everyone
                    id: guild.roles.everyone.id,

                    deny: [
                        PermissionFlagsBits.ViewChannel,
                    ],
                },

                {
                    // BauaaCore
                    id: guild.members.me.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.EmbedLinks,
                        PermissionFlagsBits.ReadMessageHistory,
                    ],
                },
            ],
        });
    }

    const createdChannels = {};

    // Create individual log channels
    for (const [key, channelName] of Object.entries(logConfig.channels)) {
        let channel = guild.channels.cache.find(
            channel =>
                channel.parentId === category.id &&
                channel.name === channelName
        );

        if (!channel) {
            channel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: category.id,

                permissionOverwrites: [
                    {
                        // @everyone cannot see logs
                        id: guild.roles.everyone.id,

                        deny: [
                            PermissionFlagsBits.ViewChannel,
                        ],
                    },

                    {
                        // BauaaCore can see and write logs
                        id: guild.members.me.id,

                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.EmbedLinks,
                            PermissionFlagsBits.ReadMessageHistory,
                        ],
                    },
                ],
            });
        }

        createdChannels[key] = channel;
    }

    return createdChannels;
}

module.exports = {
    setupLogging,
};