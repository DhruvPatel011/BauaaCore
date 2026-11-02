
const { getDatabase } = require("../config/database");

const COLLECTION = "ignored_entities";

function getCollection() {
    return getDatabase().collection(COLLECTION);
}

async function addIgnored(guildId, id, type, addedBy) {
    const collection = getCollection();

    await collection.createIndex(
        { guildId: 1, id: 1 },
        { unique: true }
    );

    const result = await collection.updateOne(
        { guildId, id },
        {
            $setOnInsert: {
                guildId,
                id,
                type,
                addedBy,
                createdAt: new Date(),
            },
        },
        { upsert: true }
    );

    return {
        added: result.upsertedCount > 0,
        exists: result.upsertedCount === 0,
    };
}

async function removeIgnored(guildId, id) {
    const result = await getCollection().deleteOne({
        guildId,
        id,
    });

    return result.deletedCount > 0;
}

async function listIgnored(guildId) {
    return getCollection()
        .find({ guildId })
        .sort({ createdAt: -1 })
        .toArray();
}

// Deliberately checks ID regardless of stored type.
// This also handles bots accidentally added as "user".
async function isIgnored(guildId, id) {
    if (!guildId || !id) return false;

    const record = await getCollection().findOne(
        { guildId, id },
        { projection: { _id: 1 } }
    );

    return Boolean(record);
}

async function isMessageIgnored(message) {
    if (!message?.guild) return false;

    // Webhook ID
    if (message.webhookId) {
        const webhookIgnored = await isIgnored(
            message.guild.id,
            message.webhookId
        );

        if (webhookIgnored) return true;
    }

    // Author ID (normal user or bot)
    if (message.author?.id) {
        return isIgnored(
            message.guild.id,
            message.author.id
        );
    }

    return false;
}

module.exports = {
    addIgnored,
    removeIgnored,
    listIgnored,
    isIgnored,
    isMessageIgnored,
};
