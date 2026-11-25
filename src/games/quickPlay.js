const crypto = require("node:crypto");
const { ButtonStyle } = require("discord.js");
const {
    CLOSE_BUTTON, REPLAY_BUTTON, RESULT_COLOR, button, gameCard, openGame, replayRow, row,
} = require("./session");

const RPS_THEME = { title: "✊ Rock Paper Scissors", color: 0xA883FF };
const GUESS_THEME = { title: "🎯 Number Guess", color: 0x2BC6BA };
const HANDS = [
    { id: "rock", label: "Rock", emoji: "✊", beats: "scissors" },
    { id: "paper", label: "Paper", emoji: "✋", beats: "rock" },
    { id: "scissors", label: "Scissors", emoji: "✌️", beats: "paper" },
];
const GUESS_ATTEMPTS = 3;
const MAX_NUMBER = 10;
const GUESS_NUMBERS = Array.from({ length: MAX_NUMBER }, (_, index) => index + 1);

function playRps(interaction) {
    const score = { win: 0, draw: 0, loss: 0 };
    let revealed = false;
    const footer = () => `You ${score.win} · Draws ${score.draw} · BauaaCore ${score.loss}`;

    function choices(picked) {
        return [
            row(...HANDS.map(hand =>
                button(hand.id, hand.label, hand === picked ? ButtonStyle.Primary : ButtonStyle.Secondary)
                    .setEmoji(hand.emoji)
                    .setDisabled(Boolean(picked))
            )),
            row(button(CLOSE_BUTTON, "Close").setDisabled(Boolean(picked))),
        ];
    }

    function ready() {
        return gameCard(RPS_THEME, "Pick your hand.", { rows: choices(), footer: footer() });
    }

    return openGame(interaction, {
        theme: RPS_THEME,
        players: [interaction.user.id],
        initial: ready(),
        move(click) {
            if (click.customId === REPLAY_BUTTON) {
                if (!revealed) return "Finish this round first.";
                revealed = false;
                return { message: ready() };
            }
            if (revealed) return "Select Play again to start another round.";

            const hand = HANDS.find(choice => choice.id === click.customId);
            if (!hand) return "Pick Rock, Paper, or Scissors.";
            const bot = HANDS[crypto.randomInt(HANDS.length)];
            let outcome = "draw";
            if (hand !== bot) outcome = hand.beats === bot.id ? "win" : "loss";
            const headline = { win: "You win!", loss: "BauaaCore wins!", draw: "It's a draw!" }[outcome];
            const frame = gameCard(RPS_THEME, `**You** · ${hand.emoji} ${hand.label}\n**BauaaCore** · ✊ ✋ ✌️\n*Choosing a hand…*`, {
                rows: choices(hand),
                footer: footer(),
            });
            score[outcome] += 1;
            revealed = true;
            return {
                frame,
                revealAfter: 560,
                message: gameCard(RPS_THEME, `### ${headline}\n**You** · ${hand.emoji} ${hand.label}\n**BauaaCore** · ${bot.emoji} ${bot.label}`, {
                    rows: [replayRow()],
                    footer: footer(),
                    color: RESULT_COLOR[outcome],
                }),
            };
        },
    });
}

function playGuess(interaction) {
    let secret = crypto.randomInt(1, MAX_NUMBER + 1);
    const guesses = new Set();
    let low = 1;
    let high = MAX_NUMBER;
    let revealed = false;

    function render(body, { lastGuess, locked = false, outcome } = {}) {
        const left = GUESS_ATTEMPTS - guesses.size;
        const meter = "●".repeat(left) + "○".repeat(guesses.size);
        if (outcome) {
            return gameCard(GUESS_THEME, body, {
                rows: [replayRow()],
                footer: `Tried ${[...guesses].join(" · ")}`,
                color: RESULT_COLOR[outcome],
            });
        }
        const buttons = GUESS_NUMBERS.map(number =>
            button(`guess:${number}`, String(number), number === lastGuess ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(locked || guesses.has(number) || number < low || number > high)
        );
        return gameCard(GUESS_THEME, body, {
            rows: [
                row(...buttons.slice(0, 5)),
                row(...buttons.slice(5)),
                row(button(CLOSE_BUTTON, "Close").setDisabled(locked)),
            ],
            footer: `${meter} · ${left} ${left === 1 ? "guess" : "guesses"} left`,
        });
    }

    function ready() {
        return render(`Pick a number from **1 to ${MAX_NUMBER}**.`);
    }

    return openGame(interaction, {
        theme: GUESS_THEME,
        players: [interaction.user.id],
        initial: ready(),
        move(click) {
            if (click.customId === REPLAY_BUTTON) {
                if (!revealed) return "Finish this round first.";
                secret = crypto.randomInt(1, MAX_NUMBER + 1);
                guesses.clear();
                low = 1;
                high = MAX_NUMBER;
                revealed = false;
                return { message: ready() };
            }
            if (revealed) return "Select Play again to guess a new number.";

            const match = /^guess:(10|[1-9])$/.exec(click.customId);
            if (!match) return "Pick a number on the board.";
            const guess = Number(match[1]);
            if (guesses.has(guess)) return "You already tried that number.";
            if (guess < low || guess > high) return `Pick a number between ${low} and ${high}.`;

            guesses.add(guess);
            const frame = render(`Checking **${guess}**…`, { lastGuess: guess, locked: true });
            let message;
            if (guess === secret || guesses.size === GUESS_ATTEMPTS) {
                const correct = guess === secret;
                revealed = true;
                message = render(`### ${correct ? "You got it!" : "Out of guesses"}\nThe number was **${secret}**.`, {
                    outcome: correct ? "win" : "loss",
                });
            } else {
                const higher = guess < secret;
                if (higher) low = guess + 1;
                else high = guess - 1;
                const range = low === high ? `**${low}**` : `**${low}–${high}**`;
                message = render(`### ${higher ? "↑ Higher" : "↓ Lower"} than ${guess}\nAvailable numbers ${range}.`, {
                    lastGuess: guess,
                });
            }
            return { frame, revealAfter: 400, message };
        },
    });
}

module.exports = { playRps, playGuess };
