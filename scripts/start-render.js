const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { resolve } = require("node:path");
const { getInstanceRole, handlesCommand } = require("../src/utils/instanceRole");
const { captureLavalink } = require("../src/utils/runtimeLog");

const root = resolve(__dirname, "..");
const host = "127.0.0.1";
const audioPort = "2333";
const botPort = process.env.PORT || "10000";
const instanceRole = getInstanceRole({ BAUAA_INSTANCE_ROLE: process.env.BAUAA_INSTANCE_ROLE });
const withAudio = handlesCommand(instanceRole, true);
const botEnv = {
    ...process.env,
    BAUAA_INSTANCE_ROLE: instanceRole,
    BAUAA_EMBEDDED_LAVALINK: withAudio ? "1" : "0",
    BAUAA_RENDER_LOGS: "1",
    PORT: botPort,
};
if (withAudio) {
    Object.assign(botEnv, {
        LAVALINK_URL: `http://${host}:${audioPort}`,
        LAVALINK_PASSWORD: process.env.LAVALINK_PASSWORD || randomBytes(32).toString("hex"),
        MUSIC_MEDIA_BASE_URL: `http://${host}:${botPort}`,
        MUSIC_YTDLP_PATH: resolve(root, ".tools", "yt-dlp"),
    });
}

function start(name, command, args, cwd, env, captureAudio = false) {
    const stdio = captureAudio ? ["ignore", "pipe", "pipe"] : "inherit";
    const child = spawn(command, args, { cwd, env, stdio });
    if (captureAudio) captureLavalink(child, env.LAVALINK_PASSWORD, { render: true });
    child.once("error", error => console.error(`[Render] ${name} process error: ${error.code || error.name}`));
    const closed = new Promise(resolve => {
        child.once("close", (code, signal) => resolve({ code, signal }));
    });
    return { child, closed };
}

async function stop({ child, closed }, gracePeriod) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return closed;
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), gracePeriod);
    try {
        await closed;
    } finally {
        clearTimeout(timeout);
    }
}

let audio;
let restartTimer;
let stopping = false;

function startAudio() {
    audio = start("Lavalink", "java", [
        "-XX:MaxRAMPercentage=35.0", "-XX:ActiveProcessorCount=1", "-XX:+UseSerialGC",
        "-XX:+ExitOnOutOfMemoryError", "-jar", "Lavalink.jar",
    ], resolve(root, "music-node"), {
        ...process.env,
        LAVALINK_PASSWORD: botEnv.LAVALINK_PASSWORD,
        SERVER_ADDRESS: host,
        SERVER_PORT: audioPort,
        SPRING_PROFILES_ACTIVE: "render",
    }, true);
    void audio.closed.then(({ code, signal }) => {
        if (stopping) return;
        console.warn(`[Render] Lavalink stopped (${signal ?? code}). Retrying in 5 seconds.`);
        restartTimer = setTimeout(startAudio, 5_000);
    });
}

async function shutdown(code) {
    if (stopping) return;
    stopping = true;
    clearTimeout(restartTimer);
    await stop(bot, 13_000);
    if (audio) await stop(audio, 10_000);
    process.exitCode = code;
}

if (withAudio) startAudio();
const bot = start("BauaaCore", process.execPath, [resolve(root, "src", "index.js")], root, botEnv);
void bot.closed.then(({ code, signal }) => {
    if (stopping) return;
    console.error(`[Render] BauaaCore stopped (${signal ?? code}).`);
    return shutdown(code || 1);
});
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
