const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const timers = require("node:timers/promises");
const { ButtonStyle, ComponentType, InteractionContextType, MessageFlags } = require("discord.js");
const game = require("../src/commands/game");

const PLAYER = "100000000000000001";
const OPPONENT = "100000000000000002";
const OTHER_MEMBER = "100000000000000003";

function cardText(payload) {
    return payload.components[0].toJSON().components
        .filter(component => component.type === ComponentType.TextDisplay)
        .map(component => component.content)
        .join("\n");
}

function mockGame(subcommand, opponent = { id: OPPONENT, bot: false }) {
    const collector = new EventEmitter();
    collector.stop = function (reason) {
        if (this.ended) return;
        this.ended = true;
        this.reason = reason;
        this.emit("end", new Map(), reason);
    };

    let board;
    let collectorOptions;
    let deferred;
    let reply;
    const frames = [];
    const interaction = {
        user: { id: PLAYER },
        inGuild: () => true,
        options: { getSubcommand: () => subcommand, getUser: () => opponent },
        async reply(payload) { reply = payload; },
        async deferReply(options) { deferred = options; },
        async editReply(payload) {
            board = payload;
            return {
                createMessageComponentCollector(options) {
                    collectorOptions = options;
                    return collector;
                },
            };
        },
    };

    return {
        start: () => game.execute(interaction),
        collector,
        frames,
        get options() { return collectorOptions; },
        get board() { return board; },
        get text() { return cardText(board); },
        get buttons() {
            return board.components[0].toJSON().components
                .filter(component => component.type === ComponentType.ActionRow)
                .flatMap(row => row.components);
        },
        get deferred() { return deferred; },
        get reply() { return reply; },
        async click(userId, customId, beforeUpdate) {
            assert.ok(!collector.ended, "the game must be open to collect a move");
            let response;
            const press = {
                user: { id: userId },
                customId,
                async reply(payload) { response = payload; },
                async update(payload) {
                    if (beforeUpdate) await beforeUpdate();
                    board = payload;
                    frames.push(cardText(payload));
                },
            };
            if (collectorOptions.filter(press)) collector.emit("collect", press);
            await timers.setImmediate();
            return response;
        },
    };
}

test("game registers a server slash command, with the opponent required for Tic-Tac-Toe", () => {
    const command = game.data.toJSON();
    assert.equal(command.name, "game");
    assert.deepEqual(command.contexts, [InteractionContextType.Guild]);
    assert.deepEqual(command.options.map(option => option.name), ["rps", "guess", "tictactoe"]);
    assert.equal(command.options[2].options[0].required, true);
});

test("rock paper scissors locks the controls during the reveal and keeps score through a replay", async t => {
    t.mock.method(crypto, "randomInt", () => 2);
    let finishReveal;
    const reveal = new Promise(resolve => { finishReveal = resolve; });
    t.mock.method(timers, "setTimeout", () => reveal);
    const round = mockGame("rps");
    await round.start();
    assert.equal(round.deferred.flags, MessageFlags.Ephemeral);
    assert.equal(round.board.flags, MessageFlags.IsComponentsV2);
    assert.equal(round.options.componentType, ComponentType.Button);
    assert.deepEqual(round.buttons.map(button => button.label), ["Rock", "Paper", "Scissors", "Close"]);

    const rejected = await round.click(OTHER_MEMBER, "rock");
    assert.equal(rejected.flags, MessageFlags.Ephemeral);
    await round.click(PLAYER, "rock");
    assert.match(round.text, /Choosing a hand/);
    assert.ok(round.buttons.every(button => button.disabled));
    assert.match((await round.click(PLAYER, "paper")).content, /board is updating/);
    finishReveal();
    await timers.setImmediate();

    assert.match(round.text, /You win![\s\S]+BauaaCore\*\* · ✌️ Scissors/);
    assert.match(round.text, /You 1 · Draws 0 · BauaaCore 0/);
    assert.deepEqual(round.buttons.map(button => button.label), ["Play again", "Close"]);

    await round.click(PLAYER, "game:again");
    assert.match(round.text, /Pick your hand/);
    assert.match(round.text, /You 1 · Draws 0 · BauaaCore 0/);
    await round.click(PLAYER, "game:close");
    assert.match(round.text, /Game closed/);
    assert.equal(round.collector.reason, "closed");
});

test("number guess hints higher or lower, rejects repeats, and stops after three guesses", async t => {
    t.mock.method(crypto, "randomInt", () => 7);
    t.mock.method(timers, "setTimeout", async () => {});
    const round = mockGame("guess");
    await round.start();
    assert.equal(round.deferred.flags, MessageFlags.Ephemeral);
    assert.equal(round.buttons.filter(button => button.custom_id.startsWith("guess:")).length, 10);

    await round.click(PLAYER, "guess:3");
    assert.match(round.frames.at(-1), /Checking \*\*3\*\*/);
    assert.match(round.text, /Higher than 3[\s\S]+2 guesses left/);
    assert.equal(round.buttons.find(button => button.custom_id === "guess:3").disabled, true);
    assert.equal(round.buttons.find(button => button.custom_id === "guess:2").disabled, true);
    const repeat = await round.click(PLAYER, "guess:3");
    assert.match(repeat.content, /already tried/);

    await round.click(PLAYER, "guess:8");
    assert.match(round.text, /Lower than 8[\s\S]+1 guess left/);
    await round.click(PLAYER, "guess:6");
    assert.match(round.text, /Out of guesses[\s\S]+\*\*7\*\*/);
    await round.click(PLAYER, "game:again");
    assert.match(round.text, /3 guesses left/);
    assert.ok(round.buttons.every(button => !button.disabled));

    await round.click(PLAYER, "guess:7");
    assert.match(round.text, /You got it![\s\S]+\*\*7\*\*/);
});

test("Tic-Tac-Toe animates moves, highlights the winning line, and needs two votes for a rematch", async t => {
    t.mock.method(timers, "setTimeout", async () => {});
    const starters = [0, 1];
    t.mock.method(crypto, "randomInt", limit => {
        assert.equal(limit, 2);
        return starters.shift();
    });
    const round = mockGame("tictactoe");
    await round.start();
    assert.deepEqual(round.deferred, {});
    assert.deepEqual(round.board.allowedMentions.users, [OPPONENT]);
    assert.equal((await round.click(OTHER_MEMBER, "accept")).flags, MessageFlags.Ephemeral);
    assert.match((await round.click(PLAYER, "accept")).content, /invited player/);

    await round.click(OPPONENT, "accept");
    const openingSquares = round.buttons.filter(button => button.custom_id.startsWith("cell:"));
    assert.deepEqual(openingSquares.map(square => square.label), Array(9).fill("·"));
    assert.deepEqual(round.board.allowedMentions.parse, []);
    assert.match((await round.click(OPPONENT, "cell:0")).content, /Wait for your turn/);
    await round.click(PLAYER, "cell:0");
    assert.match(round.frames.at(-1), /X placed/);
    assert.match(round.text, /O to move/);
    assert.equal(round.buttons.find(button => button.custom_id === "cell:0").style, ButtonStyle.Success);
    assert.match((await round.click(OPPONENT, "cell:0")).content, /already taken/);
    await round.click(OPPONENT, "cell:3");
    await round.click(PLAYER, "cell:1");
    await round.click(OPPONENT, "cell:4");
    await round.click(PLAYER, "cell:2");

    assert.match(round.frames.at(-1), /Three in a row/);
    assert.match(round.text, /wins as \*\*X\*\*/);
    assert.ok(round.buttons.filter(button => button.custom_id.startsWith("cell:")).every(button => button.disabled));
    const winning = round.buttons.filter(button => button.style === ButtonStyle.Success);
    assert.deepEqual(winning.map(button => button.custom_id), ["cell:0", "cell:1", "cell:2"]);

    await round.click(PLAYER, "game:again");
    assert.match(round.text, /accept the rematch/);
    assert.equal(round.buttons.find(button => button.custom_id === "game:again").label, "Accept rematch");
    assert.match((await round.click(PLAYER, "game:again")).content, /Your vote is in/);
    await round.click(OPPONENT, "game:again");
    assert.match(round.text, /O to move/);
    assert.match(round.text, /X leads the session/);
    assert.ok(round.buttons.every(button => !button.disabled));
    for (const frame of [...round.frames, round.text]) {
        assert.doesNotMatch(frame.replace(/<@\d+>/g, ""), /\d/);
    }
});

test("Tic-Tac-Toe serializes moves and removes controls at timeout", async t => {
    t.mock.method(crypto, "randomInt", () => 0);
    const round = mockGame("tictactoe");
    await round.start();
    await round.click(OPPONENT, "accept");

    let finishUpdate;
    const pendingUpdate = new Promise(resolve => { finishUpdate = resolve; });
    await round.click(PLAYER, "cell:0", () => pendingUpdate);
    assert.match((await round.click(OPPONENT, "cell:2")).content, /board is updating/);
    round.collector.stop("idle");
    finishUpdate();
    await timers.setImmediate();
    assert.match(round.text, /timed out/);
    assert.equal(round.buttons.length, 0);
});

test("Tic-Tac-Toe can pick O to start both rounds and supports draws and forfeits", async t => {
    t.mock.method(timers, "setTimeout", async () => {});
    t.mock.method(crypto, "randomInt", () => 1);
    const round = mockGame("tictactoe");
    await round.start();
    await round.click(OPPONENT, "accept");
    assert.match(round.text, /O to move/);
    assert.match((await round.click(PLAYER, "cell:0")).content, /Wait for your turn/);

    for (const [turn, square] of [0, 1, 2, 4, 3, 5, 7, 6, 8].entries()) {
        await round.click(turn % 2 === 0 ? OPPONENT : PLAYER, `cell:${square}`);
    }
    assert.match(round.frames.at(-1), /Board full/);
    assert.match(round.text, /It's a draw!/);
    await round.click(PLAYER, "game:again");
    await round.click(OPPONENT, "game:again");
    assert.match(round.text, /O to move/);
    await round.click(PLAYER, "forfeit");
    assert.match(round.text, /forfeited/);
    assert.match(round.text, /O leads the session/);
});
