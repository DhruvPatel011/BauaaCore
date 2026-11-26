const { getDatabase } = require("../config/database");
const { MusicError, TRACK_LIMIT } = require("./shared");

const defaultSettings = {
    stay: false, announce: true, buttons: true, voiceStatus: false, sponsors: false,
    announceChannel: null, djRole: null, djCommands: [], restrictedChannels: {}, prefix: null,
};

function library(getDb = getDatabase) {
    function collection() {
        return getDb().collection("music_library");
    }

    async function read(id, fallback = {}) {
        return (await collection().findOne({ _id: id }))?.value ?? fallback;
    }

    async function change(id, initial, update) {
        const entries = collection();
        for (let attempt = 0; attempt < 6; attempt++) {
            const previous = await entries.findOne({ _id: id });
            const value = update(previous?.value ?? structuredClone(initial));
            if (!previous) {
                try {
                    await entries.insertOne({ _id: id, value, revision: 1 });
                    return value;
                } catch (error) {
                    if (error.code !== 11000) throw error;
                    continue;
                }
            }
            const result = await entries.updateOne({ _id: id, revision: previous.revision }, {
                $set: { value }, $inc: { revision: 1 },
            });
            if (result.matchedCount) return value;
        }
        throw new MusicError("Your music settings changed at the same time. Try again.");
    }

    function key(name) {
        const value = name.trim().toLowerCase();
        if (!value || value.length > 60) throw new MusicError("Playlist names must contain 1 to 60 characters.");
        return value;
    }

    return {
        read,
        change,
        settings: async guild => ({ ...defaultSettings, ...await read(`guild:${guild}`) }),
        configure: (guild, update) => change(`guild:${guild}`, defaultSettings, update),
        liked: user => read(`liked:${user}`, []),
        editLiked: (user, update) => change(`liked:${user}`, [], update),
        playlists: user => read(`playlists:${user}`, []),
        async getPlaylist(user, name) {
            const id = key(name);
            const playlist = (await read(`playlists:${user}`, [])).find(item => item.id === id);
            if (!playlist) throw new MusicError("You don’t have a playlist with that name.");
            return playlist;
        },
        editPlaylist(user, name, update, create = false) {
            const id = key(name);
            return change(`playlists:${user}`, [], playlists => {
                const index = playlists.findIndex(item => item.id === id);
                if (create && index >= 0) throw new MusicError("You already have a playlist with that name.");
                if (create && playlists.length >= 15) throw new MusicError("You can save up to 15 playlists.");
                if (!create && index < 0) throw new MusicError("You don’t have a playlist with that name.");
                const updated = update(playlists[index] ?? { id, name: name.trim(), tracks: [], cover: null });
                if (updated?.tracks.length > TRACK_LIMIT) throw new MusicError(`A playlist can contain up to ${TRACK_LIMIT} tracks.`);
                if (create) return [...playlists, updated];
                playlists.splice(index, 1, ...(updated ? [updated] : []));
                return playlists;
            });
        },
    };
}

module.exports = { library, defaultSettings };
