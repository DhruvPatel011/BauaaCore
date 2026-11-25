const timers = require("node:timers/promises");
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    ContainerBuilder,
    MessageFlags,
    SeparatorBuilder,
    SeparatorSpacingSize,
    TextDisplayBuilder,
} = require("discord.js");

const NO_MENTIONS = { parse: [] };
const IDLE_TIMEOUT = 2 * 60_000;
const SESSION_TIMEOUT = 10 * 60_000;
const CLOSE_BUTTON = "game:close";
const REPLAY_BUTTON = "game:again";
const RESULT_COLOR = { win: 0x30B981, loss: 0xF07178, draw: 0xE9AE5B };

function button(id, label, style = ButtonStyle.Secondary) {
    return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

function row(...buttons) {
    return new ActionRowBuilder().addComponents(...buttons);
}

function replayRow(label = "Play again") {
    return row(
        button(REPLAY_BUTTON, label, ButtonStyle.Primary).setEmoji("🔁"),
        button(CLOSE_BUTTON, "Close"),
    );
}

function gameCard(theme, body, { rows = [], footer, color = theme.color, ping } = {}) {
    const card = new ContainerBuilder()
        .setAccentColor(color)
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${theme.title}`))
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
    if (rows.length) {
        card
            .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
            .addActionRowComponents(...rows);
    }
    if (footer) card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${footer}`));
    return {
        components: [card],
        allowedMentions: ping ? { parse: [], users: [ping] } : NO_MENTIONS,
    };
}

function replyPrivately(interaction, content) {
    return interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: NO_MENTIONS });
}

async function openGame(interaction, { theme, players, initial, move, privateGame = true }) {
    await interaction.deferReply(privateGame ? { flags: MessageFlags.Ephemeral } : {});
    const message = await interaction.editReply({ flags: MessageFlags.IsComponentsV2, ...initial });
    const collector = message.createMessageComponentCollector({
        componentType: ComponentType.Button,
        idle: IDLE_TIMEOUT,
        time: SESSION_TIMEOUT,
        filter(click) {
            if (players.includes(click.user.id)) return true;
            void replyPrivately(click, "This game belongs to the invited players.").catch(() => {});
            return false;
        },
    });
    let pending;
    let closed = false;

    collector.on("collect", click => {
        if (collector.ended) {
            void replyPrivately(click, "This game has ended.").catch(() => {});
            return;
        }
        if (pending) {
            void replyPrivately(click, "The board is updating. Try again in a moment.").catch(() => {});
            return;
        }
        pending = applyMove(click).finally(() => { pending = null; });
    });

    async function applyMove(click) {
        try {
            const result = click.customId === CLOSE_BUTTON
                ? { message: gameCard(theme, "Game closed."), close: true }
                : move(click);
            if (typeof result === "string") {
                await replyPrivately(click, result).catch(() => {});
                return;
            }

            // Acknowledge the click immediately and keep the board locked during the reveal.
            await click.update(result.frame || result.message);
            if (result.frame && !collector.ended) {
                await timers.setTimeout(result.revealAfter);
                if (!collector.ended) await interaction.editReply(result.message);
            }
            if (result.close) {
                closed = true;
                collector.stop("closed");
            }
        } catch (error) {
            console.error("Game move failed:", error);
            collector.stop("moveError");
        }
    }

    collector.on("end", async (_, reason) => {
        if (!["idle", "time", "moveError"].includes(reason)) return;

        await pending;
        if (closed) return;
        const status = reason === "moveError" ? "The game couldn't update." : "Game timed out.";
        await interaction.editReply(gameCard(theme, status, {
            footer: "Use /game to start a new session.",
        })).catch(() => {});
    });
}

module.exports = {
    CLOSE_BUTTON,
    REPLAY_BUTTON,
    RESULT_COLOR,
    button,
    gameCard,
    openGame,
    replayRow,
    replyPrivately,
    row,
};
