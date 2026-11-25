const { ChannelType, PermissionFlagsBits } = require("discord.js");
const { getDatabase } = require("../config/database");
const logConfig = require("../config/logs");

const CACHE_TTL_MS = 30_000;
const MAX_CACHED_GUILDS = 1_000;
const BOT_LOG_PERMISSIONS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
];

const configs = new Map();
const setups = new Map();

function getCollection() {
    return getDatabase().collection("guild_log_config");
}

function isPrivate(channel, guild) {
    const everyone = guild.roles.everyone;
    return channel.permissionOverwrites.cache.get(everyone.id)
        ?.deny.has(PermissionFlagsBits.ViewChannel) === true &&
        channel.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel) === false;
}

function findLegacyCategory(guild) {
    const candidates = guild.channels.cache.filter(channel =>
        channel.type === ChannelType.GuildCategory &&
        channel.name === logConfig.categoryName &&
        isPrivate(channel, guild)
    );
    return candidates.size === 1 ? candidates.first() : null;
}

function isLogChannel(channel, category, guild) {
    return channel?.type === ChannelType.GuildText &&
        channel.parentId === category.id &&
        isPrivate(channel, guild);
}

function findLegacyChannel(guild, category, name) {
    const candidates = guild.channels.cache.filter(channel =>
        channel.name === name && isLogChannel(channel, category, guild)
    );
    return candidates.size === 1 ? candidates.first() : null;
}

async function loadLoggingConfig(guild) {
    const collection = getCollection();
    const filter = { _id: guild.id };
    const saved = await collection.findOne(filter);
    if (saved) return saved;

    const category = findLegacyCategory(guild);
    if (!category) return null;

    const channels = {};
    for (const [key, name] of Object.entries(logConfig.channels)) {
        const channel = findLegacyChannel(guild, category, name);
        if (channel) channels[key] = channel.id;
    }
    if (!Object.keys(channels).length) return null;

    const legacy = { categoryId: category.id, channels };
    const result = await collection.updateOne(filter, { $setOnInsert: legacy }, { upsert: true });
    return result.upsertedCount ? legacy : collection.findOne(filter);
}

function getLoggingConfig(guild) {
    const cached = configs.get(guild.id);
    if (cached && cached.expires > Date.now()) return cached.value;

    const value = loadLoggingConfig(guild).catch(error => {
        if (configs.get(guild.id)?.value === value) configs.delete(guild.id);
        throw error;
    });
    if (configs.size >= MAX_CACHED_GUILDS) configs.clear();
    configs.set(guild.id, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
}

function inspectCategory(guild, config) {
    if (!config) return { issue: "Run /setup-logs to configure logging." };

    const category = guild.channels.cache.get(config.categoryId);
    if (category?.type !== ChannelType.GuildCategory) {
        return { issue: "The saved log category is missing." };
    }
    if (!isPrivate(category, guild)) {
        return { category, issue: "The log category must deny View Channel to @everyone." };
    }
    return { category };
}

function inspectDestination(guild, id, category) {
    if (!id) return { issue: "Unconfigured" };
    const channel = guild.channels.cache.get(id);
    if (!channel) return { issue: "Saved channel is missing" };
    if (channel.type !== ChannelType.GuildText) {
        return { issue: "Saved destination is not a text channel" };
    }
    if (channel.parentId !== category.id) {
        return { channel, issue: "Outside the saved log category" };
    }
    if (!isPrivate(channel, guild)) {
        return { channel, issue: "Must deny View Channel to @everyone" };
    }
    if (!guild.members.me || !channel.permissionsFor(guild.members.me)?.has(BOT_LOG_PERMISSIONS)) {
        return { channel, issue: "Bot needs View Channel, Send Messages, and Embed Links" };
    }
    return { channel };
}

async function getLogChannel(guild, key) {
    const config = await getLoggingConfig(guild);
    const { category, issue } = inspectCategory(guild, config);
    if (issue) return null;

    const destination = inspectDestination(guild, config.channels?.[key], category);
    return destination.issue ? null : destination.channel;
}

async function sendConfiguredLog(guild, key, payload) {
    const channel = await getLogChannel(guild, key);
    if (!channel) return false;
    await channel.send(payload);
    return true;
}

async function getLoggingStatus(guild) {
    const config = await getLoggingConfig(guild);
    const { category, issue } = inspectCategory(guild, config);
    return {
        category,
        categoryIssue: issue,
        canViewAuditLog: Boolean(guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)),
        destinations: Object.entries(logConfig.channels).map(([key, name]) => ({
            name,
            ...(issue
                ? { issue: config?.channels?.[key] ? "Log category unavailable" : "Unconfigured" }
                : inspectDestination(guild, config.channels?.[key], category)),
        })),
    };
}

async function configureLogging(guild) {
    const current = await getLoggingConfig(guild);
    const existing = inspectCategory(guild, current);
    const permissionOverwrites = [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: guild.members.me.id,
            allow: [...BOT_LOG_PERMISSIONS, PermissionFlagsBits.ReadMessageHistory],
        },
    ];

    let category = existing.issue ? null : existing.category;
    if (!category) {
        category = findLegacyCategory(guild) || await guild.channels.create({
            name: logConfig.categoryName,
            type: ChannelType.GuildCategory,
            permissionOverwrites,
        });
    }

    const collection = getCollection();
    const filter = { _id: guild.id };
    const channels = current?.categoryId === category.id ? { ...current.channels } : {};
    await collection.updateOne(filter, { $set: { categoryId: category.id, channels } }, { upsert: true });
    configs.delete(guild.id);

    const configured = {};
    for (const [key, name] of Object.entries(logConfig.channels)) {
        const saved = guild.channels.cache.get(channels[key]);
        const channel = isLogChannel(saved, category, guild)
            ? saved
            : findLegacyChannel(guild, category, name) || await guild.channels.create({
                name,
                type: ChannelType.GuildText,
                parent: category.id,
                permissionOverwrites,
            });
        if (channel.id !== channels[key]) {
            channels[key] = channel.id;
            await collection.updateOne(filter, { $set: { channels: { ...channels } } });
            configs.delete(guild.id);
        }
        configured[key] = channel;
    }
    return configured;
}

function setupLogging(guild) {
    if (!setups.has(guild.id)) {
        const setup = configureLogging(guild).finally(() => setups.delete(guild.id));
        setups.set(guild.id, setup);
    }
    return setups.get(guild.id);
}

module.exports = { setupLogging, getLogChannel, getLoggingStatus, sendConfiguredLog };
