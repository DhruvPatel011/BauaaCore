const assert = require("node:assert/strict");
const { test } = require("node:test");
const { interactionDispatcher, limitInteractionCallbacks } = require("../src/utils/interactions");
const { getInstanceRole, handlesCommand } = require("../src/utils/instanceRole");

test("duplicate delivery and overlapping gateway instances execute a command only after Discord accepts its callback", async () => {
    const errors = [];
    const createDispatcher = () => interactionDispatcher({ onError: (...args) => errors.push(args) });
    const first = createDispatcher();
    const second = createDispatcher();
    let acknowledged = false;
    let callbacks = 0;
    let started = 0;
    const interaction = () => ({ id: "same-interaction", createdTimestamp: Date.now(), isChatInputCommand: () => true,
        async deferReply() {
            callbacks++;
            if (acknowledged) throw Object.assign(new Error("Already acknowledged"), { code: 40060 });
            acknowledged = true;
            this.deferred = true;
        },
        async reply() { assert.fail("No second initial reply should be attempted"); },
    });
    const command = async input => { await input.deferReply(); started++; };
    await Promise.all([first(interaction(), command), first(interaction(), command), second(interaction(), command)]);
    assert.equal(callbacks, 2);
    assert.equal(started, 1);
    assert.deepEqual(errors, []);
    assert.equal(handlesCommand("general", true), false);
    assert.equal(handlesCommand("music", false), false);
    assert.equal(handlesCommand(getInstanceRole({ RENDER: "true" }), true), true);
});

test("expired and uncertain Discord callbacks do not trigger an error reply", async () => {
    const errors = [];
    const dispatch = interactionDispatcher({ onError: (label, error) => errors.push([label, error?.code]) });
    for (const code of [10062, "ECONNRESET"]) {
        const interaction = { id: String(code), createdTimestamp: Date.now(), isChatInputCommand: () => true,
            async deferReply() { throw Object.assign(new Error("Callback failed"), { code }); },
            async reply() { assert.fail("An ambiguous callback must never be repeated"); },
        };
        await dispatch(interaction, input => input.deferReply());
    }
    await dispatch({ id: "expired", createdTimestamp: Date.now() - 3_001 }, () => assert.fail("Expired command ran"));
    assert.deepEqual(errors, [
        ["Discord rejected acknowledgement", 10062], ["Handler failed", "ECONNRESET"],
        ["Interaction arrived after its acknowledgement deadline", undefined],
    ]);
});

test("initial callbacks have a separate deadline and ordinary REST requests keep their defaults", async () => {
    const epoch = 1_420_070_400_000;
    const routeAt = time => `/interactions/${BigInt(time - epoch) << 22n}/test/callback`;
    const rest = { post: async () => "ordinary" };
    const callbacks = { async post(route, options) { assert.ok(options.signal instanceof AbortSignal); return "callback"; } };
    limitInteractionCallbacks(rest, callbacks);
    assert.equal(await rest.post(routeAt(Date.now()), { auth: false }), "callback");
    await assert.rejects(rest.post(routeAt(Date.now() - 3_001), { auth: false }), { code: 10062 });
    assert.equal(await rest.post("/channels/123/messages"), "ordinary");
});

test("a failed edit after deferral does not send another error response", async () => {
    const errors = [];
    const dispatch = interactionDispatcher({ onError: (label, error) => errors.push([label, error.code]) });
    let edits = 0;
    const interaction = { id: "deferred", createdTimestamp: Date.now(), isChatInputCommand: () => true,
        async deferReply() { this.deferred = true; },
        async editReply() { edits++; throw Object.assign(new Error("Connection reset"), { code: "ECONNRESET" }); },
    };
    await dispatch(interaction, async input => { await input.deferReply(); await input.editReply({ content: "Done" }); });
    assert.equal(edits, 1);
    assert.deepEqual(errors, [["Handler failed", "ECONNRESET"]]);
});
