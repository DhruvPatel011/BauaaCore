# BauaaCore

BauaaCore is an open-source Discord bot that helps server owners organize their server logs. With a single `/setup-logs` command, it creates a logging category with separate channels for different server activities.

## Features

- Set up logging channels with `/setup-logs`.
- Log deleted, bulk-deleted, and edited messages.
- Track member joins, leaves, and updates.
- Log bans and unbans.
- Track channel and role changes.
- Log voice-channel activity.
- Use Discord slash commands for setup.

## Logging Channels

The bot creates an `All Log & Info` category with separate channels for different events.

| Channel | Purpose |
|---|---|
| `all-logs` | General logs |
| `kick-ban-logs` | Ban and unban events |
| `main-bots-logs` | Bot-related logs |
| `role-logs` | Role changes |
| `deleted-msg-logs` | Deleted messages |
| `edited-msg-logs` | Edited messages |
| `vc-logs` | Voice activity |
| `channel-logs` | Channel changes |
| `members-log` | Member activity |

The events recorded depend on the bot's current configuration and available Discord permissions.

## Add the Bot

[**Invite BauaaCore to your Discord server**](https://discord.com/oauth2/authorize?client_id=1557321479027163196&permissions=8&integration_type=0&scope=bot)

1. Open the invite link.
2. Select your server.
3. Review the requested permissions.
4. Authorize the bot.

You must have permission to add bots to the selected server.

**Important:** The current invite link requests Administrator permission. This gives the bot broad access to the server. Only authorize it if you trust the bot. A more restrictive permission set is preferable when it supports all required features.

## Set Up Logging

After inviting the bot:

1. Make sure BauaaCore is online.
2. Open your server and enter `/setup-logs` in a text channel.
3. Run the command.
4. Check the `All Log & Info` category.

The bot needs sufficient permissions to create channels and send log messages. Test the logging channels to confirm that events are being recorded.

## Run Locally

### Requirements

- Node.js and npm
- A Discord application and bot token

### Installation

Clone the repository:

```bash
git clone https://github.com/DhruvPatel011/BauaaCore.git
cd BauaaCore
npm install
```

Create a `.env` file in the project root:

```env
DISCORD_TOKEN=your_bot_token
```

Replace the placeholder with your own bot token from the [Discord Developer Portal](https://discord.com/developers/applications).

Start the bot:

```bash
npm start
```

## Security

- Never share your bot token or commit it to GitHub.
- Keep `.env` private and ensure it is listed in `.gitignore`.
- Use environment variables to store secrets when deploying.
- Review permissions before inviting the bot to a server.
- Do not run code from untrusted sources without reviewing it.
- If your token is exposed, reset it immediately in the Discord Developer Portal.

## Hosting

BauaaCore can run on a compatible Node.js hosting service.

For Render, use these settings:

- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment Variable:** `DISCORD_TOKEN`

A continuously running Discord bot requires a hosting plan that supports persistent processes. Free plans may sleep or have other restrictions.

## Contributing

Contributions and bug reports are welcome.

1. Fork the repository.
2. Create a branch for your changes.
3. Test your changes.
4. Open a pull request with a short description.

Please do not include tokens, passwords, or other secrets in commits or issue reports.

## Links

- **Repository:** [GitHub](https://github.com/DhruvPatel011/BauaaCore)
- **Invite Bot:** [Add BauaaCore](https://discord.com/oauth2/authorize?client_id=1557321479027163196&permissions=8&integration_type=0&scope=bot)
- **Issues:** [Report a problem](https://github.com/DhruvPatel011/BauaaCore/issues)
- **Discord Developer Portal:** [Manage your application](https://discord.com/developers/applications)

## License

This repository does not specify a license in this README. Add a `LICENSE` file before claiming particular open-source reuse or distribution rights.

---

Made by [Dhruv Patel](https://github.com/DhruvPatel011).
