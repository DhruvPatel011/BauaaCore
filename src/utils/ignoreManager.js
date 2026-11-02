const { getDatabase } = require("../config/database");

const COLLECTION = "ignored_entities";

async function addIgnored(guildId, id, type, addedBy) {
    const collection = getDatabase().collection(COLLECTION);

    try {
        await collection.insertOne({
            guildId,
            id,
            type,
            addedBy,
            createdAt: new Date(),
        });
        return { added: true };
    } catch (error) {
        if (error.code === 11000) return { added: false, exists: true };
        throw error;
    }
}

async function removeIgnored(guildId, id) {
    const result = await getDatabase()
        .collection(COLLECTION)
        .deleteOne({ guildId, id });

    return result.deletedCount > 0;
}

async function listIgnored(guildId) {
    return getDatabase()
        .collection(COLLECTION)
        .find({ guildId })
        .sort({ createdAt: -1 })
        .toArray();
}

async function isIgnored(guildId, id) {
    if (!guildId || !id) return false;

    const record = await getDatabase()
        .collection(COLLECTION)
        .findOne({ guildId, id }, { projection: { _id: 1 } });

    return Boolean(record);
}

module.exports = {
    addIgnored,
    removeIgnored,
    listIgnored,
    isIgnored,
};
