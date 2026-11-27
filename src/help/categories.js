const filters = require("../music/filters");

const generalCategories = [
    ["Server logging", "Set up log channels, check permissions, and manage ignored IDs.", "logging", ["setup-logs", "logs-status", "ignore"]],
    ["Zoya AI", "Set up AI channels, tune Zoya, and manage memory and instructions.", "ai-assistant", [
        "ai-setup", "ai-add-channel", "ai-list-channels", "ai-remove-channel", "ai-status",
        "ai-enable", "ai-disable", "ai-mood", "ai-reset", "ai-memory", "ai-instructions",
    ]],
    ["Games", "Play Rock Paper Scissors, Guess the Number, or Tic-Tac-Toe.", "games", ["game"]],
];

const musicCategories = [
    ["Start listening", "Queue a song, search for music, or open the player.", "music", [
        "play", "nowplaying", "search", "playfile", "connect", "searchalbum", "searchartist", "searchplaylist", "speak",
    ]],
    ["Playback controls", "Pause, skip, seek, repeat, adjust volume, or leave voice.", "music", [
        "pause", "resume", "skip", "voteskip", "previous", "replay", "seek", "forward", "rewind",
        "volume", "loop", "autoplay", "stop", "disconnect",
    ]],
    ["Music queue", "See what's next, reorder requests, or move the player.", "music", [
        "queue", "history", "skipto", "bump", "move", "shuffle", "remove", "leavecleanup", "clear",
    ]],
    ["Music library", "Find lyrics, save liked tracks, or manage playlists.", "music", [
        "lyrics", "grab", "like", "dislike", "showliked", "sortliked", "playliked", "clearliked", "playlist",
    ]],
    ["Audio effects", "Apply an effect to the player or restore the original sound.", "music", [...Object.keys(filters), "resetfilter"]],
    ["Music accounts", "Connect Spotify or set up Last.fm scrobbling.", "music", ["spotify", "lastfm"]],
    ["Music settings", "Configure the player, announcements, DJ roles, and channel access.", "music", [
        "settings", "announce", "buttons", "voicechannelstatus", "247", "sponsorblock", "setprefix", "dj",
        "restrictcommand", "restrict", "unrestrict",
    ]],
    ["Music diagnostics", "Check the audio node, repair playback, or view bot information.", "music", [
        "debug", "forcefix", "switchaudionode", "music",
    ]],
];

module.exports = { generalCategories, musicCategories };
