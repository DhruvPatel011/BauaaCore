const { listPanel } = require("./panel");
const { queued, positionIn, requireTrack } = require("./playback");
const { MusicError, musicText, TRACK_LIMIT } = require("./shared");

function asTracks(items) {
    return items.map(item => ({ info: item }));
}

async function collections(music, interaction, command, options) {
    const action = options.sub || command;
    const voice = ["play", "playliked", "addnowplaying", "savequeue"].includes(action);
    const ctx = await music.guard(interaction, command, { voice, player: ["addnowplaying", "savequeue"].includes(action) });
    const { userId } = ctx;
    const { data } = music;
    const { name, page } = options;

    if (command !== "playlist") {
        if (command === "clearliked") {
            if (!options.confirm) throw new MusicError("Set `confirm` to true to clear your liked tracks.");
            await data.editLiked(userId, () => []);
            return "Cleared your liked tracks.";
        }
        if (command === "sortliked") {
            await data.editLiked(userId, items => items.sort((a, b) => a[options.by].localeCompare(b[options.by])));
            return `Sorted liked tracks by ${options.by}.`;
        }
        const liked = await data.liked(userId);
        if (command === "showliked") return listPanel("Your liked songs", asTracks(liked), page);
        return queued(await music.enqueue(interaction, ctx, liked, { stored: true }), "your liked songs");
    }

    switch (action) {
        case "list": {
            const playlists = await data.playlists(userId);
            return playlists.length ? playlists.map(item => `**${musicText(item.name, 60)}** · ${item.tracks.length} tracks`).join("\n") :
                "You don’t have any playlists yet. Use `/playlist create`.";
        }
        case "create":
            await data.editPlaylist(userId, name, item => item, true);
            return `Created **${musicText(name)}**.`;
        case "delete":
            await data.editPlaylist(userId, name, () => null);
            return `Deleted **${musicText(name)}**.`;
        case "view":
        case "play": {
            const item = await data.getPlaylist(userId, name);
            if (action === "view") return listPanel(item.name, asTracks(item.tracks), page, item.cover);
            return queued(await music.enqueue(interaction, ctx, item.tracks, { stored: true }), item.name);
        }
        case "setcover": {
            let url = null;
            if (options.image) {
                try {
                    const image = new URL(options.image);
                    if (image.protocol !== "https:" || image.username || image.password || image.href.length > 1000) throw new Error();
                    url = image.href;
                } catch {
                    throw new MusicError("Enter a public HTTPS image link, or omit it to remove the cover.");
                }
            }
            await data.editPlaylist(userId, name, item => ({ ...item, cover: url }));
            return url ? "Playlist cover updated." : "Playlist cover removed.";
        }
        case "removetrack":
            await data.editPlaylist(userId, name, item => {
                item.tracks.splice(positionIn(item.tracks, options.position), 1);
                return item;
            });
            return `Removed track #${options.position} from **${musicText(name)}**.`;
        case "addtrack":
        case "import":
        case "addnowplaying":
        case "savequeue": {
            let tracks;
            if (action === "addnowplaying") tracks = [music.storeTrack(requireTrack(ctx.player))].filter(Boolean);
            else if (action === "savequeue") tracks = [ctx.player.queue.current, ...ctx.player.queue.tracks].filter(Boolean).map(music.storeTrack).filter(Boolean);
            else {
                const result = await music.lookup(ctx.guild.id, options.query, userId);
                if (action === "import" && !result.playlist) throw new MusicError("Use a playlist or album link to import multiple tracks.");
                const source = result.selection ? result.tracks.slice(0, 1) : result.tracks;
                tracks = result.matched ? source : source.map(music.storeTrack).filter(Boolean);
            }
            if (!tracks.length) throw new MusicError("No tracks can be saved from that source.");
            if (action === "import" || action === "savequeue") {
                await data.editPlaylist(userId, name, item => ({ ...item, tracks: tracks.slice(0, TRACK_LIMIT) }), true);
            } else {
                await data.editPlaylist(userId, name, item => ({ ...item, tracks: [...item.tracks, ...tracks] }));
            }
            return `Saved **${Math.min(tracks.length, TRACK_LIMIT)} tracks** to **${musicText(name)}**.`;
        }
        default:
            throw new MusicError("Choose a playlist action.");
    }
}

module.exports = { collections };
