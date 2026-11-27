const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmdirSync, unlinkSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { stripVTControlCharacters } = require("node:util");
const stringWidth = require("string-width");
const { createTerminal } = require("../src/utils/terminal");
const { safeText } = require("../src/utils/runtimeLog");

function capture(isTTY, columns = 80) {
    return {
        isTTY, columns, output: "", hasColors: () => true,
        write(chunk) { this.output += chunk; },
    };
}

const metrics = { bot: "Bauaa界", servers: 3, commands: 12, port: 10000, audio: "Connected" };

test("the VS Code dashboard tracks actual service stages and measures their duration", t => {
    const out = capture(true);
    let now = 0;
    const terminal = createTerminal({ out, err: capture(true), env: { TERM: "xterm-256color" }, now: () => now, uptime: () => 1500 });
    t.after(() => terminal.abort());

    terminal.begin("all");
    for (const [stage, end] of [["lavalink", 250], ["http", 375], ["mongodb", 875], ["discord", 1125]]) {
        terminal.stage(stage, "working");
        now = end;
        terminal.stage(stage, "ready");
    }
    terminal.complete(metrics);
    assert.match(out.output, /80%/);
    assert.doesNotMatch(out.output, /Startup complete/);

    terminal.stage("audio", "working");
    now += 200;
    terminal.stage("audio", "ready");
    assert.equal(terminal.stage("audio", "ready"), false);
    terminal.complete(metrics);

    const shown = stripVTControlCharacters(out.output);
    assert.match(out.output, /\x1b\[38;2;/);
    assert.match(shown, /100%/);
    assert.match(shown, /MongoDB\s+Ready\s+500ms/);
    assert.match(shown, /Audio Node\s+Ready\s+200ms/);
    assert.match(shown, /Bot\s+Bauaa界/);
    assert.match(shown, /Uptime\s+1.5s/);
    const frame = shown.split("\n").filter(line => /^  [╭│╰]/.test(line));
    assert.equal(frame.length, 6);
    assert.equal(new Set(frame.map(stringWidth)).size, 1);
});

test("dumb terminals use plain logs and interrupted startup never prints a success dashboard", () => {
    const out = capture(true);
    const err = capture(true);
    const terminal = createTerminal({ out, err, env: { TERM: "dumb" } });
    terminal.begin("general");
    terminal.stage("lavalink", "skipped", "Disabled for this role");
    terminal.stage("http", "working", "Opening listener");
    terminal.stage("http", "failed", "Port already in use");
    terminal.beginShutdown("Closing services");
    terminal.finishShutdown(true, "Services closed");
    assert.doesNotMatch(out.output + err.output, /\x1b|[^\x00-\x7f]|100%/);
    assert.match(err.output, /ERROR\s+\[HTTP Server\] Port already in use/);
    assert.match(out.output, /SUCCESS\s+\[Shutdown\] Services closed/);
});

test("logging redacts credential values, URLs, auth headers, and terminal control codes", () => {
    const message = safeText(
        "\x1b[31mConnection failed for fake-lavalink-password\x1b[0m " +
        "https://example.invalid/a?signed=private-query\r\n" +
        'password="abc12" Authorization: Basic unlisted-credential',
        ["fake-lavalink-password"],
    );
    assert.match(message, /^Connection failed/);
    assert.doesNotMatch(message, /fake-lavalink-password|private-query|abc12|unlisted-credential|[\x1b\r\n]/);
});

test("routine JVM warnings and debug logs go to separate files while errors stay visible", t => {
    const directory = mkdtempSync(join(tmpdir(), "bauaacore-logs-"));
    const application = join(directory, "application.ndjson");
    const lavalink = join(directory, "lavalink.ndjson");
    t.after(() => {
        for (const file of [application, lavalink]) {
            try { unlinkSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
        }
        rmdirSync(directory);
    });

    const output = spawnSync(process.execPath, ["-e", `
        const { PassThrough } = require("node:stream");
        const { captureLavalink, log } = require(${JSON.stringify(require.resolve("../src/utils/runtimeLog"))});
        const child = { stdout: new PassThrough(), stderr: new PassThrough() };
        captureLavalink(child, "test-only-java-password");
        log("DEBUG", "Playback", "routine playback trace");
        child.stdout.end("[Lavalink] INFO Authentication disabled\\n");
        child.stderr.end(
            "WARNING: A restricted method in java.lang.System has been called\\n" +
            "Picked up JAVA_TOOL_OPTIONS: -Dname=hidden-jvm-option\\n" +
            "[Lavalink] ERROR Connection failed for test-only-java-password\\n"
        );
    `], { encoding: "utf8", env: { ...process.env, BAUAA_LOG_DIR: directory, BAUAA_VERBOSE: "0" } });

    assert.equal(output.status, 0, output.stderr);
    assert.doesNotMatch(output.stdout + output.stderr, /restricted method|routine playback trace|test-only-java-password|hidden-jvm-option/);
    assert.match(output.stderr, /WARNING\s+\[Lavalink JVM\] Authentication disabled/);
    assert.match(output.stderr, /ERROR\s+\[Lavalink JVM\] Connection failed/);
    assert.match(readFileSync(application, "utf8"), /"level":"DEBUG".*routine playback trace/);
    const javaLogs = readFileSync(lavalink, "utf8");
    assert.match(javaLogs, /"level":"WARNING".*restricted method/);
    assert.doesNotMatch(javaLogs, /test-only-java-password|routine playback trace|hidden-jvm-option/);
});
