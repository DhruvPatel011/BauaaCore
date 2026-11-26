const { defaultSettings } = require("./library");
const { MusicError, musicText } = require("./shared");

const toggles = { "247": "stay", announce: "announce", buttons: "buttons", voicechannelstatus: "voiceStatus", sponsorblock: "sponsors" };

async function settingsCommand(music, interaction, command, options, commands) {
    const sub = options.sub;
    const view = (command === "settings" && sub === "view") || (command === "dj" && sub === "info");
    const ctx = await music.guard(interaction, command, { manage: !view });
    const { settings, guild, player } = ctx;
    const update = next => music.data.configure(guild.id, next);
    if (Object.hasOwn(toggles, command)) {
        const key = toggles[command];
        const enabled = options.enabled ?? (options.channel || options.here ? true : !settings[key]);
        if (command === "sponsorblock" && player) await music.applySponsors(player, enabled);
        const next = await update(current => ({ ...current, [key]: enabled,
            ...(options.channel ? { announceChannel: options.channel.id } : {}),
            ...(command === "announce" && options.here ? { announceChannel: interaction.channelId } : {}),
        }));
        if (player) await music.sync(player, command === "announce").catch(() => {});
        return `${{ "247": "24/7 voice", announce: "Track announcements", buttons: "Track buttons",
            voicechannelstatus: "Voice channel status", sponsorblock: "Sponsor skipping" }[command]} ${next[key] ? "enabled" : "disabled"}.`;
    }
    if (command === "settings") {
        if (sub === "reset") {
            if (!options.confirm) throw new MusicError("Set `confirm` to true to reset music settings.");
            if (player && settings.sponsors) await music.applySponsors(player, false).catch(() => {});
            await update(() => structuredClone(defaultSettings));
            if (player) await music.sync(player, true).catch(() => {});
            return "Restored this server’s default music settings.";
        }
        return ["**Music settings**", `24/7 voice · ${settings.stay ? "On" : "Off"}`,
            `Announcements · ${settings.announce ? (settings.announceChannel ? `<#${settings.announceChannel}>` : "Player text channel") : "Off"}`,
            `Track buttons · ${settings.buttons ? "On" : "Off"}`, `Voice channel status · ${settings.voiceStatus ? "On" : "Off"}`,
            `Sponsor skipping · ${settings.sponsors ? "On" : "Off"}`, `DJ role · ${settings.djRole ? `<@&${settings.djRole}>` : "Off"}`,
            `Prefix · ${settings.prefix ? musicText(settings.prefix) : "Off"}`,
            ...Object.entries(settings.restrictedChannels).map(([channel, restricted]) =>
                `<#${channel}> · ${restricted.map(name => `/${name}`).join(", ")}`).slice(0, 6),
        ].join("\n").slice(0, 1950);
    }
    if (command === "dj") {
        if (sub === "info") {
            return `DJ role · ${settings.djRole ? `<@&${settings.djRole}>` : "Off"}\nDJ-only commands · ${settings.djCommands.map(name => `/${name}`).join(", ") || "None"}`;
        }
        if (sub === "setup") {
            if (!options.role || options.role.id === guild.id) throw new MusicError("Choose a DJ role other than @everyone.");
            await update(current => ({ ...current, djRole: options.role.id }));
            return `DJ role set to <@&${options.role.id}>. Use \`/dj restrict\` to choose DJ-only commands.`;
        }
        if (sub === "reset") {
            await update(current => ({ ...current, djRole: null, djCommands: [] }));
            return "Turned off DJ restrictions.";
        }
    }
    if (command === "setprefix") {
        if (!options.value) {
            await update(current => ({ ...current, prefix: null }));
            return "Disabled the music text prefix.";
        }
        if (!/^[!?.~$+%#&;:]{1,5}$/.test(options.value)) throw new MusicError("Use 1 to 5 punctuation characters for the prefix, like `!` or `.`.");
        await update(current => ({ ...current, prefix: options.value }));
        return `Music prefix set to \`${options.value}\`. Try \`${options.value}play song name\`.`;
    }
    const name = options.command?.toLowerCase().replace(/^\//, "");
    if (!commands.has(name)) throw new MusicError("Enter the name of a music command, such as `skip`. Use `/music help` for the list.");
    if (command === "dj") {
        const enabled = options.enabled ?? !settings.djCommands.includes(name);
        await update(current => {
            if (!current.djRole && enabled) throw new MusicError("Set up a DJ role with `/dj setup` first.");
            return { ...current, djCommands: enabled ? [...new Set([...current.djCommands, name])] : current.djCommands.filter(item => item !== name) };
        });
        return enabled ? `Only DJs and server managers can use \`/${name}\`.` : `Removed the DJ requirement from \`/${name}\`.`;
    }
    const channelId = options.channel?.id || interaction.channelId;
    const enabled = command === "unrestrict" ? false : (options.enabled ?? true);
    await update(current => {
        const channels = { ...current.restrictedChannels };
        const items = new Set(channels[channelId] || []);
        if (enabled) items.add(name);
        else items.delete(name);
        if (items.size) channels[channelId] = [...items];
        else delete channels[channelId];
        if (Object.keys(channels).length > 100) throw new MusicError("You can configure restrictions for up to 100 channels.");
        return { ...current, restrictedChannels: channels };
    });
    return `\`/${name}\` ${enabled ? "restricted" : "enabled"} in <#${channelId}>.`;
}

module.exports = { settingsCommand, toggles };
