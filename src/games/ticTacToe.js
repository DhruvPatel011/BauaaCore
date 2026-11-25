const { ButtonStyle } = require("discord.js");
const {
    REPLAY_BUTTON, RESULT_COLOR, button, gameCard, openGame, replayRow, replyPrivately, row,
} = require("./session");

const THEME = { title: "❎ Tic-Tac-Toe", color: 0x769DFF };
const MARKS = ["X", "O"];
const MARK_STYLES = { X: ButtonStyle.Danger, O: ButtonStyle.Primary };
const WIN_LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
];

function playTicTacToe(interaction, opponent) {
    const challenger = interaction.user;
    if (opponent.bot) return replyPrivately(interaction, "Pick another member to play Tic-Tac-Toe.");
    if (challenger.id === opponent.id) return replyPrivately(interaction, "Pick someone other than yourself.");

    const players = [challenger.id, opponent.id];
    const board = Array(9).fill("");
    const wins = [0, 0];
    const rematchVotes = new Set();
    let draws = 0;
    let startingPlayer = 0;
    let turn = startingPlayer;
    let accepted = false;
    let lastMove = -1;
    let winningLine = [];
    let result;

    function render(status, { locked = false, color = THEME.color } = {}) {
        const buttons = board.map((mark, index) => {
            const style = winningLine.includes(index) || (index === lastMove && !result)
                ? ButtonStyle.Success
                : MARK_STYLES[mark];
            return button(`cell:${index}`, mark || String(index + 1), style)
                .setDisabled(locked || Boolean(result) || Boolean(mark));
        });
        const rows = [0, 3, 6].map(index => row(...buttons.slice(index, index + 3)));
        if (!locked) {
            const label = rematchVotes.size ? "Rematch 1/2" : "Rematch";
            rows.push(result ? replayRow(label) : row(button("forfeit", "Forfeit", ButtonStyle.Danger)));
        }
        return gameCard(THEME, `**X** <@${players[0]}>  ·  **O** <@${players[1]}>\n\n${status}`, {
            rows,
            footer: `X wins ${wins[0]} · Draws ${draws} · O wins ${wins[1]}`,
            color,
        });
    }

    function showTurn() {
        return render(`### ${MARKS[turn]} to move\n<@${players[turn]}>, pick an open square.`);
    }

    function showResult() {
        const waiting = rematchVotes.size
            ? `\n<@${players.find(player => !rematchVotes.has(player))}>, accept the rematch to play again.`
            : "";
        return render(`${result.headline}${waiting}`, { color: RESULT_COLOR[result.outcome] });
    }

    function requestRematch(click) {
        if (click.customId !== REPLAY_BUTTON) return "Select Rematch to play again.";
        if (rematchVotes.has(click.user.id)) return "Your vote is in. The other player can accept the rematch.";
        rematchVotes.add(click.user.id);
        if (rematchVotes.size === 1) return { message: showResult() };

        board.fill("");
        rematchVotes.clear();
        winningLine = [];
        lastMove = -1;
        result = null;
        startingPlayer = 1 - startingPlayer;
        turn = startingPlayer;
        return { message: showTurn() };
    }

    function answerChallenge(click) {
        if (click.customId === "cancel" && click.user.id === challenger.id) {
            return { message: gameCard(THEME, "Challenge canceled."), close: true };
        }
        if (click.user.id !== opponent.id) return "The invited player can accept or decline.";
        if (click.customId === "decline") {
            return { message: gameCard(THEME, "Challenge declined."), close: true };
        }
        if (click.customId !== "accept") return "Accept the challenge to start.";
        accepted = true;
        return { message: showTurn() };
    }

    return openGame(interaction, {
        theme: THEME,
        players,
        privateGame: false,
        initial: gameCard(THEME, `<@${challenger.id}> challenged <@${opponent.id}>.`, {
            rows: [row(
                button("accept", "Accept", ButtonStyle.Success),
                button("decline", "Decline"),
                button("cancel", "Cancel"),
            )],
            ping: opponent.id,
        }),
        move(click) {
            if (!accepted) return answerChallenge(click);
            if (result) return requestRematch(click);
            if (click.customId === "forfeit") {
                const winner = players.findIndex(player => player !== click.user.id);
                wins[winner] += 1;
                result = { outcome: "win", headline: `### <@${players[winner]}> wins\n<@${click.user.id}> forfeited.` };
                return { message: showResult() };
            }

            const match = /^cell:([0-8])$/.exec(click.customId);
            if (!match) return "Pick an open square on the board.";
            if (click.user.id !== players[turn]) return "Wait for your turn.";
            const square = Number(match[1]);
            if (board[square]) return "That square is already taken.";

            const mark = MARKS[turn];
            board[square] = mark;
            lastMove = square;
            winningLine = WIN_LINES.find(line => line.every(index => board[index] === mark)) || [];
            if (winningLine.length) {
                wins[turn] += 1;
                result = { outcome: "win", headline: `### <@${players[turn]}> wins as **${mark}**!` };
                return {
                    frame: render("### Three in a row!", { locked: true, color: RESULT_COLOR.win }),
                    revealAfter: 520,
                    message: showResult(),
                };
            }
            if (board.every(Boolean)) {
                draws += 1;
                result = { outcome: "draw", headline: "### It's a draw!" };
                return {
                    frame: render("### Board full", { locked: true, color: RESULT_COLOR.draw }),
                    revealAfter: 520,
                    message: showResult(),
                };
            }
            turn = 1 - turn;
            return {
                frame: render(`### ${mark} placed\nSquare **${square + 1}**`, { locked: true }),
                revealAfter: 275,
                message: showTurn(),
            };
        },
    });
}

module.exports = { playTicTacToe };
