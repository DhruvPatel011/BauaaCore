const { MongoClient } = require("mongodb");

let client;
let database;

async function connectDatabase() {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
        throw new Error("MONGODB_URI is missing!");
    }

    client = new MongoClient(uri, {
        serverSelectionTimeoutMS: 15000,
        connectTimeoutMS: 15000,
    });

    await client.connect();

    // Use the database name in the URI path (for example /bauaacore).
    database = client.db();
    await database.command({ ping: 1 });

    // One ID can be ignored only once per guild.
    await database.collection("ignored_entities").createIndex(
        { guildId: 1, id: 1 },
        { unique: true }
    );

    console.log(`✅ MongoDB connected | Database: ${database.databaseName}`);
    return database;
}

function getDatabase() {
    if (!database) {
        throw new Error("MongoDB is not connected!");
    }
    return database;
}

async function closeDatabase() {
    if (client) {
        await client.close();
        client = null;
        database = null;
        console.log("🔒 MongoDB connection closed.");
    }
}

module.exports = { connectDatabase, getDatabase, closeDatabase };
