
<h1>BauaaCore</h1>

<p align="center">
  <img src="assets/bauaa-logo.png" height="160" alt="Bauaa Logo">
  &nbsp;&nbsp;
  <img src="assets/BAUAACORE Minimalist Wordmark.png" height="160" alt="BauaaCore Dragon Banner">
</p>

<p align="center">
  <strong>A Discord bot for server activity logging, moderation visibility, AI-powered conversations, and music playback in voice channels.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Discord.js-v14-5865F2?style=flat&logo=discord&logoColor=white" alt="Discord.js">
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=flat&logo=mongodb&logoColor=white" alt="MongoDB">
  <img src="https://img.shields.io/badge/AI-Groq-F55036?style=flat" alt="Groq AI">
  <img src="https://img.shields.io/badge/License-Educational%20Use-lightgrey?style=flat" alt="License">
</p>

<p align="center">
  <a href="#about">About</a> ·
  <a href="#features">Features</a> ·
  <a href="#screenshots">Screenshots</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#music">Music</a> ·
  <a href="#getting-started">Installation</a>
</p>

---

## About

**BauaaCore** is a Discord bot for server management, activity monitoring, AI-powered conversations, and listening to music together.

It brings four core capabilities together in one system:

- **Server Logging** — Monitor important server activities through organized logging channels.
- **Ignore Management** — Exclude selected users, bots, and webhooks from activity logging.
- **AI Assistant** — Enable AI-powered conversations in configured Discord channels.
- **Music** — Play supported tracks in voice, manage the queue, and save playlists.

Built using Node.js, discord.js, MongoDB, the Groq API, and Lavalink.

**Created and maintained by Bauaa.**

> **Private educational use only.** [See license terms](#license).

---

## Features

### 1. Server Logging

Monitor important activities across your Discord server with structured and dedicated log channels.

Supported events include:

- Member joins and leaves
- Message deletions and edits
- Role activity
- Channel modifications
- Voice channel joins and leaves
- Member kicks and bans
- Bot-related activity

All logs are organized into dedicated Discord channels for easier monitoring and management.

Bot voice joins, leaves, and moves are filtered automatically.

### 2. Ignore Management

Control which entities are excluded from server logging.

- Add users, bots, and webhooks to the ignore list.
- Remove previously ignored entities.
- View all currently ignored entries.
- Manage ignored entities independently.

### 3. AI Assistant

Zoya is BauaaCore's conversational AI chatbot in Discord, powered by Groq. Greetings, affection, and direct jabs get a short chat line. Longer questions can get steps or examples when the topic calls for them.

- Configure AI-enabled channels.
- Add or remove AI channels.
- Enable or disable the assistant.
- Check the current AI status.
- Customize the assistant's mood.
- Configure custom AI instructions.
- Reset conversation context.

### 4. AI Memory

Manage user-specific conversational memories stored in MongoDB.

- View saved memories.
- Add new memories.
- Forget individual memories.
- Clear all saved memories.
- Configured memory expiry: **180 days**.

### 5. Music Playback

Play music for everyone in a Discord voice channel and control it from a shared player card.

- Queue music by song name, supported link, or audio upload. Public Spotify playlist links can queue tracks that have a playable match.
- Pause, skip, replay, shuffle, loop, or vote to skip from the controller. Use `/nowplaying` to find the card again.
- Save liked songs and personal playlists in MongoDB. Look up lyrics or send the current track details to your DMs.
- Apply audio filters, configure a DJ role, and choose an announcement channel. Enable `/247` to keep the player connected while idle.

See [music commands](#music) and [audio server setup](#run-the-music-server).

---

## Screenshots

Explore BauaaCore's features and interface through the following screenshots.

### Server Logging

Monitor voice channel activity through structured Discord log messages.

<img src="assets/Screenshot%202026-11-17%20092314.png" width="100%" alt="BauaaCore Server Logging">

### AI Assistant

Interact with the AI assistant directly inside a configured Discord channel.

<img src="assets/Screenshot%202026-11-17%20092457.png" width="100%" alt="BauaaCore AI Assistant">

### Bot Profile

The BauaaCore bot profile and its Discord identity.

<img src="assets/Screenshot%202026-11-17%20092543.png" width="100%" alt="BauaaCore Bot Profile">

---

## Architecture

BauaaCore routes Discord events and slash commands to its logging, AI, and music services. The bot manages the queue and sends playback controls to Lavalink, which delivers audio to Discord voice channels.

### System Architecture

<img src="assets/BauaaCore%20System%20Architecture%20Flow.png" width="100%" alt="BauaaCore System Architecture">

### Main Components

| Component | Responsibility |
|---|---|
| Node.js | Application runtime |
| discord.js | Discord events and interactions |
| MongoDB | Server settings, AI memory, saved playlists, and liked tracks |
| Groq API | AI response generation |
| Lavalink | Audio decoding, playback, and filters |
| dotenv | Environment configuration |

---

## Commands

Run `/help` in Discord to browse every BauaaCore slash command. Choose a category, then select a command or subcommand to see its usage and options.

### Logging

| Command | Description |
|---|---|
| `/setup-logs` | Configure server logging channels |
| `/logs-status` | Check saved log channels, visibility, and bot permissions |

Log destinations are saved by channel ID. Existing private log channels are picked up when there is a single matching category and an unambiguous destination. Use `/logs-status` to check missing destinations, permissions, and explicit role or member access. Rerun `/setup-logs` to provision replacements for missing or public channels.

### Ignore Management

| Command | Description |
|---|---|
| `/ignore add` | Add a user, bot, or webhook to the ignore list |
| `/ignore remove` | Remove an ignored entry |
| `/ignore list [page]` | View ignored entries, 15 per page |

### AI Assistant

| Command | Description |
|---|---|
| `/ai-setup` | Configure the AI assistant |
| `/ai-add-channel` | Add an AI-enabled channel |
| `/ai-remove-channel` | Remove an AI-enabled channel |
| `/ai-list-channels` | List AI-enabled channels |
| `/ai-enable` | Enable the AI assistant |
| `/ai-disable` | Disable the AI assistant |
| `/ai-status` | Check the assistant's status |
| `/ai-mood` | Change the assistant's mood |
| `/ai-reset` | Reset conversation context |

Zoya defaults to Roman Hinglish. Say `Hindi mein samjhao`, `Gujarati ma jawab aapo`, or `reply in English` for a single reply in that language. Say `switch to Gujarati` or `ab se Hindi mein baat karo` to keep that language for the current chat. `/ai-reset` clears the chat history and restores Hinglish. The server's selected mood applies in every language.

Zoya recognizes Bauaa by name and by the Discord account configured in `BOT_OWNER_ID`. She backs him up in the selected mood. Very Toxic uses blunt comebacks and can match profanity when someone insults Bauaa or Zoya.

Zoya redacts recognized private information and credentials before sending chat context to Groq. She keeps the typing indicator active while generating and screens the complete reply before posting it in Discord.

### AI Memory

| Command | Description |
|---|---|
| `/ai-memory list` | View saved memories |
| `/ai-memory add` | Add a new memory |
| `/ai-memory forget` | Forget an individual memory |
| `/ai-memory clear` | Clear saved memories |

### AI Instructions

| Command | Description |
|---|---|
| `/ai-instructions view` | View current AI instructions |
| `/ai-instructions set` | Set custom AI instructions |
| `/ai-instructions clear` | Clear custom AI instructions |

These three commands are restricted to the Discord account configured in `BOT_OWNER_ID`.

### Games

| Command | How to play |
|---|---|
| `/game rps` | Pick a hand, watch the reveal, and play another round on the same card. |
| `/game guess` | Guess a number from 1 to 10 in three tries. The board updates after each higher or lower hint. |
| `/game tictactoe opponent:@member` | Challenge a member on a board that highlights each move and the winning line. Either player can start each round at random. Both players can vote for a rematch. |

Solo games are visible to the player who started them. A round expires after two minutes of inactivity, ten minutes total, or a bot restart.

### Music

Join a voice channel and run `/play query:<song name or URL>`. Once BauaaCore is playing, join its voice channel to add tracks or operate the controller. With track announcements enabled, BauaaCore edits the shared card for routine actions like pause and skip. Queue results, lyrics, and command errors appear privately. `/nowplaying` links to the shared controller when you can access it or shows a private card when needed.

| Commands | What they do |
|---|---|
| `/play`, `/search`, `/playfile` | Queue a supported song or playlist, pick a search result, or play an uploaded file |
| `/nowplaying`, `/connect`, `/disconnect` | Find the controller or manage the voice connection |
| `/pause`, `/resume`, `/skip`, `/previous`, `/replay`, `/stop` | Control playback. `/stop` clears the queue. |
| `/seek`, `/volume`, `/loop`, `/autoplay` | Set the playback position, volume, repeat mode, or recommendations |
| `/queue`, `/history`, `/shuffle`, `/bump`, `/move track`, `/remove`, `/leavecleanup`, `/voteskip` | View, reorder, and clean up requests or vote to skip a track |
| `/playlist create`, `/playlist import`, `/playlist savequeue`, `/playlist play` | Create, import, save, and play personal playlists |
| `/like`, `/dislike`, `/showliked`, `/playliked` | Manage and play liked songs |
| `/lyrics`, `/grab` | Look up lyrics or send track details to your DMs |
| `/8d`, `/bassboost`, `/nightcore`, `/lofi`, `/resetfilter` | Apply or clear a player effect |
| `/247`, `/dj`, `/restrictcommand`, `/announce`, `/buttons`, `/voicechannelstatus` | Configure server playback, permissions, and the player card |
| `/sponsorblock`, `/forcefix`, `/switchaudionode`, `/debug` | Configure sponsor skipping, repair playback, or check the audio server |
| `/spotify`, `/lastfm`, `/searchalbum`, `/searchartist`, `/searchplaylist` | Access optional account and catalog integrations |
| `/music help` | Browse the interactive music command guide |

`/play` accepts YouTube videos and playlists, public Spotify links, and sources available on your Lavalink node. Public Spotify links use visible tracks from Spotify’s embed and match them to audio from another source. Private playlists, generated mixes, and tracks beyond the embed’s list may be unavailable. Playback depends on source availability and the audio node’s configuration.

### Command Interface

Access BauaaCore's features directly through Discord's slash command interface.

<img src="assets/Screenshot%202026-11-17%20092426.png" width="100%" alt="BauaaCore Slash Commands">

---

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| discord.js v14 | Discord bot development |
| MongoDB | Persistent settings, memory, and music library |
| Groq API | AI integration |
| Lavalink 4.2+ | Music playback and Discord voice transport |
| yt-dlp | Optional audio resolver for supported sources |
| dotenv | Environment variable management |

---

## Getting Started

Follow these steps to set up and run BauaaCore locally.

### Prerequisites

Make sure you have the following:

- [Node.js](https://nodejs.org/) and npm
- A Discord application and bot token
- A MongoDB database
- A Groq API key

### 1. Clone the Repository

```bash
git clone https://github.com/DhruvPatel011/BauaaCore.git
```

### 2. Navigate to the Project Directory

```bash
cd BauaaCore
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Configure Environment Variables

Copy [`.env.example`](.env.example) to `.env` and set the variables for your installation.

| Variable | Purpose |
|---|---|
| `DISCORD_TOKEN` | Required at startup. Discord bot token. |
| `MONGODB_URI` | Required at startup. Include the database name in the URI. |
| `GROQ_API_KEY` | Required for AI replies. |
| `GROQ_MODEL` | Primary Groq chat model. Defaults to `openai/gpt-oss-20b`. |
| `GROQ_FALLBACK_MODEL` | Backup when the primary hits a Groq rate limit. Defaults to `openai/gpt-oss-120b`. Set an empty value to turn it off. |
| `AI_GUILD_DAILY_LIMIT` | Optional per-server request cap. The default is 2,000 with a backup model and 1,000 with a single model. |
| `BOT_OWNER_ID` | Bauaa's Discord user ID. Enables tag recognition and authorizes AI instruction management. |
| `PORT` | Optional HTTP port. Defaults to `10000`. |

**Important:** Never commit your `.env` file or expose your private API keys and bot token.

When Groq returns HTTP `429` before a reply begins, Zoya tries the backup with the same API key and chat context. She skips models in cooldown for the time Groq specifies, or for 60 seconds if the response has no retry time. If both models are limited, Zoya shows a rate-limit message. Check the quotas for your organization in the [Groq console](https://console.groq.com/settings/limits).

Zoya uses the server clock in `Asia/Kolkata` to interpret relative dates. Requests for current facts and explicit web lookups use [Groq Browser Search](https://console.groq.com/docs/tool-use/built-in-tools/browser-search) with the existing `GROQ_API_KEY`. If neither configured chat model supports browser search, those requests use `openai/gpt-oss-20b`. Zoya includes links returned by the search tool and reports when a lookup cannot be verified.

For current top-song requests in India without a different platform specified, Zoya reads the [Apple Music India chart](https://music.apple.com/in/new/top-charts/songs) directly and displays the published ranks and the time it checked the page.

### 5. Start the Bot

```bash
npm start
```

### Run the music server

On Windows, run `npm.cmd start` from the repository root. With a loopback `LAVALINK_URL` and `LAVALINK_PASSWORD` configured, BauaaCore uses a running Lavalink process with that password or starts `music-node/Lavalink.jar` with Java 17 or newer. The launcher waits for Lavalink before connecting to Discord and uses the bot role configured in `.env`.

The VS Code terminal shows startup progress across the local Lavalink check, HTTP server, MongoDB, Discord gateway, and audio session. The completion dashboard shows the elapsed time for each started service, bot identity, process uptime, guild count, loaded commands, HTTP port, and audio status. If the audio session takes more than eight seconds, the dashboard shows it as still connecting and the bot continues retrying in the background. Press **Ctrl+C** to close the services.

Set any of these options in `.env` to customize the console.

| Variable | Effect |
|---|---|
| `BAUAA_THEME=light` | Use colors designed for light terminal backgrounds. `dark` selects the dark palette. |
| `NO_COLOR=1` | Use a monochrome display. |
| `BAUAA_ASCII=1` | Use ASCII characters for the spinner, status indicators, and borders. |
| `BAUAA_PLAIN=1` | Disable colors, animations, and the dashboard layout. Redirected output automatically uses plain text. |
| `BAUAA_VERBOSE=1` | Show debug messages and captured Lavalink output in the terminal. |
| `BAUAA_LOG_DIR` | Store diagnostic files in this directory. Defaults to `music-node/logs`. |

The local console displays connection failures and errors as they occur. Routine application diagnostics go to `application.ndjson`, and output from a locally launched Lavalink process goes to `lavalink.ndjson`. Each file rotates at 2 MiB and retains one previous file.

To launch specifically in music mode, select **BauaaCore Music** in the VS Code **Run and Debug** menu and press **F5**, or run `npm.cmd run start:music`.

Configure these settings in `.env` to enable music.

| Variable | Purpose |
|---|---|
| `LAVALINK_URL` | Origin of the audio node. Defaults to `http://127.0.0.1:2333`. |
| `LAVALINK_PASSWORD` | A long random password shared by BauaaCore and Lavalink. |
| `MUSIC_YTDLP_PATH` | Path to the optional `yt-dlp` executable on the bot host. Use `yt-dlp` if it is on `PATH`. |
| `MUSIC_MEDIA_BASE_URL` | Optional bot HTTP origin reachable from Lavalink for audio fallback. Use `http://127.0.0.1:10000` for a native local node or `http://host.docker.internal:10000` for Docker Desktop with `PORT=10000`. |
| `MUSIC_MEDIA_HOSTS` | Optional comma-separated hostnames for trusted public audio file URLs. |
| `LAVALINK_URL_BACKUP`, `LAVALINK_PASSWORD_BACKUP` | Optional second audio node for `/switchaudionode`. |

For YouTube audio resolution, install [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases/latest) and Node.js 22 or newer on the bot host. Run BauaaCore and Lavalink on the same internet connection because YouTube can bind stream URLs to the origin IP. The optional audio cache holds up to 32 MiB and accepts tracks up to 16 MiB each.

SoundCloud's HLS audio fallback needs FFmpeg with the `libopus` encoder on the bot host's `PATH`. The combined Render image includes it.

From the repository root, start the included node with Docker Compose.

```bash
docker compose --env-file .env -f music-node/compose.yaml up -d
npm start
```

For native Windows playback, place `Lavalink.jar` from the [Lavalink 4.2.2 release](https://github.com/lavalink-devs/Lavalink/releases/tag/4.2.2) in `music-node`. Lavalink downloads any missing plugins at startup. Use `/debug` to check the audio node and `/playfile` with an MP3 to test playback. The bot needs View Channel, Connect, and Speak. Stage playback needs Stage moderator permissions. Announcements need Send Messages and Embed Links in the configured channel.

For a hosted bot, set `LAVALINK_URL` to an audio node reachable via HTTP and WebSocket. The node needs access to the Discord voice gateway and outbound UDP. Both processes must stay online for `/247`.

YouTube sponsor skipping uses community-submitted timestamps from [SponsorBlock](https://sponsor.ajay.app/).

Public Spotify link playback needs no Spotify credentials. For Spotify account linking, set `MUSIC_ACCOUNT_SECRET`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REDIRECT_URI`. Register `https://YOUR-BOT-HOST/music/spotify/callback` as the redirect URI in Spotify’s dashboard. Enable `LAVASRC_SPOTIFY_ENABLED=true` on the audio node for Spotify catalog search. Spotify’s app access rules apply, including its [Development Mode Premium requirement](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide). Last.fm scrobbling needs `MUSIC_ACCOUNT_SECRET`, `LASTFM_API_KEY`, and `LASTFM_API_SECRET`, plus each listener’s opt-in. LRCLIB lyrics require no key. The optional Apple Music, Deezer, Tidal, Qobuz, and JioSaavn sources can be enabled with the settings in [the Lavalink configuration](music-node/application.yml) when you have the provider access those sources require.

### Render and uptime monitoring

#### Run BauaaCore and Lavalink in one Render web service

In the existing Render web service, open **Settings → Build → Source → Edit**. Select the **Docker** runtime, use the repository root as the build context, and set the Dockerfile path to `./Dockerfile`. Keep the service's `DISCORD_TOKEN`, `MONGODB_URI`, and any optional provider credentials in its **Environment** settings. Set the health check path to `/ready`.

By default the image starts BauaaCore in the `all` role on Render's `PORT` and Lavalink on `127.0.0.1:2333`. It includes the YouTube resolver. The launcher uses `LAVALINK_PASSWORD` if supplied and otherwise generates a password for the private connection on each startup.

Keep one instance responsible for music for this bot token. Stop any local `all` or `music` instance before using the combined service. Leave `BAUAA_INSTANCE_ROLE` unset or set it to `all` for this configuration. On startup, `/ready` waits for the first authenticated Lavalink connection. `/health` reports the current connection status. Point Render's HTTP health check to the bot's `/ready` on `PORT`. The embedded Lavalink API stays on authenticated loopback port `2333`.

After deployment, check for `Lavalink primary connected` and the Lavalink and YouTube plugin versions in Render's logs. Join a Discord voice channel and run `/play` with `Husn Anuv Jain`, then with `https://www.youtube.com/watch?v=gJLVTKhTnog` and `https://soundcloud.com/anuvjainjatt/husn`. Listen for audio, run `/debug` twice to check that the position advances, and look for `TrackStart` and `Playback advancing` in the logs. Queue a second song while one is playing and test `/queue`, `/pause`, `/resume`, and `/skip`.

Render Free web services can sleep when idle and have limited CPU and memory. For an unexpected `SIGTERM`, check the Render Events and Metrics tabs at the same timestamp to distinguish a deploy or restart from resource pressure. Continuous voice playback and `/247` require a host that stays awake.

#### Run BauaaCore with a separate audio node

Set the environment variables in the Render web service settings. Use `npm ci` for the build command and `npm start` for the start command. Render provides `PORT`.

To enable the YouTube audio resolver on a separate Render bot service, use `npm ci && bash scripts/install-yt-dlp.sh` as its build command. Set `MUSIC_YTDLP_PATH=./.tools/yt-dlp` and set `MUSIC_MEDIA_BASE_URL` to the bot service's public HTTPS origin. The resolver needs Node.js 22 or newer and Python 3.11 or newer for the official Unix yt-dlp executable. Lavalink can then fetch cached YouTube audio through the bot when the stream URL is bound to the bot's IP.

#### Run music on your PC and general commands on Render

Set `BAUAA_INSTANCE_ROLE=general` in Render's environment and `BAUAA_INSTANCE_ROLE=music` in the PC's `.env`. With this setup the Render Docker service starts the bot without Lavalink. The general instance registers the full slash command list, and the music instance handles music commands and player buttons. Music interactions require the music instance to be running. Start the PC instance with `npm.cmd start` and check for the `general` role on Render and the `music` role in the PC's startup banner.

Point your external uptime monitor at `/ready` to get a failure status when Discord is disconnected or MongoDB is unavailable. `/health` reports HTTP process liveness.

### Run the tests

```bash
npm test
```

---

## License

<p align="center">
  <strong>BauaaCore Educational Use License</strong>
  <br>
  Copyright &copy; 2026 Bauaa. All Rights Reserved.
</p>

<p align="center">
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-Educational%20Use-white?style=for-the-badge&labelColor=black" alt="Educational Use License">
  </a>
  <a href="https://github.com/DhruvPatel011/BauaaCore">
    <img src="https://img.shields.io/badge/Project-BauaaCore-black?style=for-the-badge&logo=github" alt="BauaaCore Repository">
  </a>
</p>

This project is released under the **BauaaCore Educational Use License**.

### Key License Terms

- You may privately use, study, and modify BauaaCore for personal, non-commercial learning.
- Get prior written permission from Bauaa before offering it for public use, using it commercially, or redistributing an original or modified copy.
- Use BauaaCore at your own risk. It is provided as is, without warranty.
- Keep Bauaa's credit and the copyright and license notices. Bauaa retains ownership of the project's original work.
- Do not make false or misleading claims about BauaaCore's authorship, official status, endorsements, capabilities, or reliability.

Read the full license for the complete terms.

<p align="center">
  <a href="LICENSE"><strong>View Full License</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/DhruvPatel011/BauaaCore/blob/main/LICENSE">Read on GitHub</a>
</p>

**Created and maintained by Bauaa.**

---

