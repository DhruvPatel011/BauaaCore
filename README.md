
<h1>BauaaCore</h1>

<p align="center">
  <img src="assets/bauaa-logo.png" height="160" alt="Bauaa Logo">
  &nbsp;&nbsp;
  <img src="assets/BauaaCore%20Dragon%20Wordmark.png" height="160" alt="BauaaCore Dragon Banner">
</p>

<p align="center">
  <strong>A Discord bot for server activity logging, moderation visibility, and AI-powered conversations.</strong>
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
  <a href="#getting-started">Installation</a>
</p>

---

## About

**BauaaCore** is a multifunctional Discord bot designed to simplify server management, activity monitoring, and AI-powered interactions.

It brings three core capabilities together in one system:

- **Server Logging** — Monitor important server activities through organized logging channels.
- **Ignore Management** — Exclude selected users, bots, and webhooks from activity logging.
- **AI Assistant** — Enable AI-powered conversations in configured Discord channels.

Built using Node.js, discord.js, MongoDB, and the Groq API.

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

### 2. Ignore Management

Control which entities are excluded from server logging.

- Add users, bots, and webhooks to the ignore list.
- Remove previously ignored entities.
- View all currently ignored entries.
- Manage ignored entities independently.

### 3. AI Assistant

Zoya is BauaaCore's conversational AI chatbot in Discord, powered by Groq. She gives short, natural answers to everyday questions and uses examples or steps when a topic needs more explanation.

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

<img src="assets/Screenshot%202026-11-17%20092543.png" width="35%" alt="BauaaCore Bot Profile">

---

## Architecture

BauaaCore connects Discord events and slash commands with its application services, database, and AI provider.

### System Architecture

<img src="assets/BauaaCore%20System%20Architecture%20Flow.png" width="100%" alt="BauaaCore System Architecture">

### Main Components

| Component | Responsibility |
|---|---|
| Node.js | Application runtime |
| discord.js | Discord events and interactions |
| MongoDB | Persistent configuration and AI memory |
| Groq API | AI response generation |
| dotenv | Environment configuration |

---

## Commands

BauaaCore uses Discord slash commands to provide access to its features.

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

### Command Interface

Access BauaaCore's features directly through Discord's slash command interface.

<img src="assets/Screenshot%202026-11-17%20092426.png" width="100%" alt="BauaaCore Slash Commands">

---

## Technology Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime |
| discord.js v14 | Discord bot development |
| MongoDB | Database and persistent memory |
| Groq API | AI integration |
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
| `BOT_OWNER_ID` | Bauaa's Discord user ID. Enables tag recognition and authorizes AI instruction management. |
| `PORT` | Optional HTTP port. Defaults to `10000`. |

**Important:** Never commit your `.env` file or expose your private API keys and bot token.

### 5. Start the Bot

```bash
npm start
```

### Render and uptime monitoring

Set the environment variables in the Render web service settings. Use `npm ci` for the build command and `npm start` for the start command. Render provides `PORT`.

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

