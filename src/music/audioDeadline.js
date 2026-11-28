const playbackBudget = 30_000;
const lookupBudget = 17_000;

async function audioStage(parent, milliseconds, work) {
    parent?.throwIfAborted();
    const controller = new AbortController();
    const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
    const timer = setTimeout(() => controller.abort(new DOMException("Audio stage timed out", "TimeoutError")), milliseconds);
    let abort;
    const canceled = new Promise((_, reject) => {
        abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
    });
    const operation = Promise.resolve().then(() => {
        signal.throwIfAborted();
        return work(signal);
    });
    return Promise.race([operation, canceled]).finally(() => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
    });
}

// lavalink-client search() has no per-call signal. Use its authenticated
// transport and track builder so the deadline also cancels the response body.
async function loadTracks(node, query, requester, signal) {
    signal?.throwIfAborted();
    if (!signal || !node.rawRequest) return node.search(query, requester);
    const identifier = query.source ? `${query.source}:${query.query}` : query.query;
    const params = new URLSearchParams({ identifier });
    const { response } = await node.rawRequest(`/loadtracks?${params}`, options => {
        options.signal = signal;
        options.redirect = "error";
    });
    if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Lavalink loadtracks returned HTTP ${response.status}`);
    }
    const { loadType, data } = await response.json();
    const tracks = loadType === "track" ? [data] : loadType === "search" ? data : loadType === "playlist" ? data.tracks : [];
    return { loadType, tracks: tracks.map(track => node.NodeManager.LavalinkManager.utils.buildTrack(track, requester)),
        playlist: loadType === "playlist" ? { title: data.info?.name || data.pluginInfo?.name } : undefined };
}

module.exports = { audioStage, loadTracks, playbackBudget, lookupBudget };
