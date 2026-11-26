
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

async function listIgnored(guildId, page, pageSize) {
    const collection = getCollection();
    const filter = { guildId };
    const total = await collection.countDocuments(filter);
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    const records = page > pageCount || total === 0 ? [] : await collection
        .find(filter)
        .sort({ createdAt: -1, id: 1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray();
    return { records, total, pageCount };
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

async function isMessageIgnored(message, guildId = message?.guild?.id) {
    if (!message || !guildId) return false;

    // Webhook ID
    if (message.webhookId) {
        const webhookIgnored = await isIgnored(
            guildId,
            message.webhookId
        );

        if (webhookIgnored) return true;
    }

    // Author ID (normal user or bot)
    return isIgnored(guildId, message.author?.id || message.member?.id || message.user?.id);
}

async function shouldSkipIgnoredEvent(eventName, args) {
    const candidates = new Set();

    const add = (value) => {
        if (
            typeof value === "string" &&
            /^\d{17,20}$/.test(value)
        ) {
            candidates.add(value);
        }
    };

    const addMessage = (message) => {
        if (!message) return;

        add(message.webhookId);
        add(message.author?.id);
        add(message.user?.id);
        add(message.member?.id);
    };

    const first = args[0];

    if (
        eventName === "messageDelete" ||
        eventName === "messageUpdate"
    ) {
        addMessage(eventName === "messageUpdate" ? args[1] : first);
        addMessage(first);

    } else if (eventName.startsWith("guildMember")) {
        add(first?.id);
        add(first?.user?.id);

    } else if (eventName.startsWith("guildBan")) {
        add(first?.user?.id);
    }

    const guild =
        first?.guild ||
        first?.member?.guild ||
        args[1]?.guild ||
        args[1]?.member?.guild;

    if (!guild || candidates.size === 0) {
        return false;
    }

    for (const id of candidates) {
        if (await isIgnored(guild.id, id)) {
            console.log(`⏭️ Ignored ${eventName} log for ID ${id}`);
            return true;
        }
    }

    return false;
}

module.exports = {
    shouldSkipIgnoredEvent,
    addIgnored,
    removeIgnored,
    listIgnored,
    isIgnored,
    isMessageIgnored,
};
