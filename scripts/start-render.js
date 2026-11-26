const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { resolve } = require("node:path");

const root = resolve(__dirname, "..");
const host = "127.0.0.1";
const audioPort = "2333";
const botPort = process.env.PORT || "10000";
const password = process.env.LAVALINK_PASSWORD || randomBytes(32).toString("hex");
const botEnv = {
    ...process.env,
    BAUAA_INSTANCE_ROLE: "all",
    BAUAA_EMBEDDED_LAVALINK: "1",
    LAVALINK_URL: `http://${host}:${audioPort}`,
    LAVALINK_PASSWORD: password,
    MUSIC_MEDIA_BASE_URL: `http://${host}:${botPort}`,
    MUSIC_YTDLP_PATH: resolve(root, ".tools", "yt-dlp"),
    PORT: botPort,
};
const audioEnv = {
    ...process.env,
    LAVALINK_PASSWORD: password,
    SERVER_ADDRESS: host,
    SERVER_PORT: audioPort,
    SPRING_PROFILES_ACTIVE: "render",
};

function start(name, command, args, cwd, env) {
    const child = spawn(command, args, { cwd, env, stdio: "inherit" });
    child.once("error", error => console.error(`[Render] ${name} process error: ${error.code || error.name}`));
    const closed = new Promise(resolve => {
        child.once("close", (code, signal) => resolve({ code, signal }));
    });
    return { child, closed };
}

async function stop({ child, closed }) {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return closed;
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
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
        "-XX:MaxRAMPercentage=35.0", "-XX:+ExitOnOutOfMemoryError", "-jar", "Lavalink.jar",
    ], resolve(root, "music-node"), audioEnv);
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
    await stop(bot);
    await stop(audio);
    process.exitCode = code;
}

startAudio();
const bot = start("BauaaCore", process.execPath, [resolve(root, "src", "index.js")], root, botEnv);
void bot.closed.then(({ code, signal }) => {
    if (stopping) return;
    console.error(`[Render] BauaaCore stopped (${signal ?? code}).`);
    return shutdown(code || 1);
});
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
