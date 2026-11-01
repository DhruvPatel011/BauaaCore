// Automatic fallback resolver. Lavalink/LavaSrc resolves provider URLs and mirrors
// services that expose metadata rather than a playable audio stream.
const FALLBACK_PREFIXES = ["ytsearch:", "scsearch:", "dzsearch:"];

async function searchWithFallback(kazagumo, query, requester) {
    const attempts = [query, ...FALLBACK_PREFIXES.map(prefix => `${prefix}${query}`)];
    let lastError;
    for (const attempt of attempts) {
        try {
            const result = await kazagumo.search(attempt, { requester });
            if (result?.tracks?.length) return result;
        } catch (error) {
            lastError = error;
        }
    }
    if (lastError) console.warn("[MusicResolver] Search attempts failed:", lastError.message);
    return { tracks: [], type: "SEARCH", playlistName: null };
}

module.exports = { searchWithFallback };
