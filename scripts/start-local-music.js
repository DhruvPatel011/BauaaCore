const { spawn, spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync } = require("node:fs");
const { delimiter, join } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const javaEnv = { ...process.env };
process.chdir(join(__dirname, ".."));
require("dotenv").config({ quiet: true });

const { getInstanceRole, handlesCommand } = require("../src/utils/instanceRole");
const { terminal } = require("../src/utils/terminal");
const { bridgeConsole, captureLavalink, log, safeText } = require("../src/utils/runtimeLog");
const { probeLavalink } = require("../src/music/nodeReadiness");

let java;
let javaClosed;
let handingOff = false;
let stopping = false;
let checkingLavalink = false;

async function stopJava() {
    if (!java) return;
    stopping = true;
    java.kill();
    await Promise.race([javaClosed, delay(2_000, undefined, { ref: false })]);
}

async function stopStartup(signal) {
    if (stopping) return;
    stopping = true;
    if (handingOff) return;
    terminal.beginShutdown("Stopping local startup");
    await stopJava();
    terminal.finishShutdown(true, "Startup cancelled");
    process.exit(signal === "SIGINT" ? 130 : 143);
}

function runBot() {
    if (stopping) return;
    if (process.platform === "win32") {
        const portableBin = join(process.cwd(), ".tools", "ffmpeg", "bin");
        if (existsSync(join(portableBin, "ffmpeg.exe"))) {
            process.env.PATH = [process.env.PATH, portableBin].filter(Boolean).join(delimiter);
        }
    }
    handingOff = true;
    const bot = require("../src/index");
    if (java) bot.setLocalLavalinkCleanup(stopJava);
}

function javaExecutable() {
    if (process.platform !== "win32") return "java";

    // The Oracle PATH shim starts a second process. Launch the JVM directly so it stops with the bot.
    const result = spawnSync("java", ["-XshowSettings:properties", "-version"], {
        encoding: "utf8",
        env: javaEnv,
        timeout: 5000,
        windowsHide: true,
    });
    if (result.error?.code === "ENOENT") throw new Error("Java is missing from PATH.");
    if (result.error?.code === "ETIMEDOUT") throw new Error("Java did not respond within 5 seconds. Check java -version.");
    const javaHome = result.stderr?.match(/^\s*java\.home\s*=\s*(.+)$/m)?.[1].trim();
    if (!javaHome) throw new Error("Could not locate the Java runtime on PATH.");
    return join(javaHome, "bin", "java.exe");
}

async function lavalinkReady(url, password) {
    const response = await probeLavalink(url, password);
    if (!response) return false;
    if (response.status === 401 || response.status === 403) {
        throw new Error("LAVALINK_PASSWORD does not match the running local Lavalink server.");
    }
    return response.ok;
}

async function waitForLavalink(url, password) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        if (await lavalinkReady(url, password)) return;
        await delay(500);
    }
    throw new Error("Lavalink did not become ready within 60 seconds. Check lavalink.ndjson or enable BAUAA_VERBOSE.");
}

async function start() {
    const automatic = process.argv[2] === "--auto";
    const role = automatic ? getInstanceRole() : "music";
    bridgeConsole();
    terminal.begin(role);
    process.on("SIGINT", stopStartup);
    process.on("SIGTERM", stopStartup);

    const missing = ["DISCORD_TOKEN", "MONGODB_URI"].filter(name => !process.env[name]?.trim());
    if (missing.length) throw new Error(`Set ${missing.join(" and ")} in .env.`);

    const password = process.env.LAVALINK_PASSWORD;
    if (automatic && (process.platform !== "win32" || process.env.RENDER === "true" || !password ||
        !handlesCommand(role, true))) return runBot();

    let url;
    try {
        url = new URL(process.env.LAVALINK_URL || "http://127.0.0.1:2333");
    } catch (error) {
        if (automatic) return runBot();
        throw new Error("Set LAVALINK_URL to a local HTTP origin for this launcher.", { cause: error });
    }
    const local = url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) &&
        url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
    if (!local) {
        if (automatic) return runBot();
        throw new Error("Set LAVALINK_URL to a local HTTP origin for this launcher.");
    }
    if (!password) throw new Error("Set LAVALINK_PASSWORD in .env.");

    checkingLavalink = true;
    terminal.stage("lavalink", "working", "Checking the local HTTP endpoint");
    if (await lavalinkReady(url, password)) {
        terminal.stage("lavalink", "ready", "Reused local server");
    } else {
        if (stopping) return;
        const cwd = join(process.cwd(), "music-node");
        if (!existsSync(join(cwd, "Lavalink.jar"))) {
            throw new Error("Place Lavalink.jar in music-node. See Run the music server in README.md.");
        }
        const pluginFiles = readFileSync(join(cwd, "plugins.sha256"), "utf8").trim().split(/\r?\n/)
            .map(line => line.trim().split(/\s+/)[1]);
        const bundledPlugins = pluginFiles.every(file => file && existsSync(join(cwd, "plugins", file)));
        const args = ["-jar", "Lavalink.jar", "--debug=false"];
        if (process.platform === "win32") {
            // Undertow needs a writable temp directory when the Windows user temp folder is restricted.
            const tempDir = join(cwd, "logs", "tmp");
            mkdirSync(tempDir, { recursive: true });
            args.unshift(`-Djava.io.tmpdir=${tempDir}`);
        }
        if (bundledPlugins) {
            // Use the existing preloaded-plugin profile to skip Maven update checks.
            args.push("--spring.profiles.active=render");
        }
        terminal.stage("lavalink", "working", "Starting the JVM");
        java = spawn(javaExecutable(), args, {
            cwd,
            env: {
                ...javaEnv,
                LAVALINK_PASSWORD: password,
                SERVER_ADDRESS: "127.0.0.1",
                SERVER_PORT: url.port || "80",
            },
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
        });
        captureLavalink(java, password);
        process.once("exit", () => java.kill());
        javaClosed = new Promise(resolve => java.once("close", resolve));
        const stopped = new Promise((_, reject) => {
            java.once("error", error => reject(new Error(
                error.code === "ENOENT" ? "Java is missing from PATH." : `Could not start Java (${error.code}).`
            )));
            java.once("close", (code, signal) => reject(new Error(`Local Java process exited (${signal ?? code}).`)));
        });
        await Promise.race([waitForLavalink(url, password), stopped]);
        void stopped.catch(error => {
            if (!stopping) log("WARNING", "Lavalink", error);
        });
        terminal.stage("lavalink", "ready", "Local JVM responding");
    }

    checkingLavalink = false;
    if (!automatic) process.env.BAUAA_INSTANCE_ROLE = role;
    runBot();
}

start().catch(error => {
    if (stopping) return;
    if (!checkingLavalink || !terminal.stage("lavalink", "failed", safeText(error.message))) log("ERROR", "Startup", error);
    terminal.abort();
    process.exit(1);
});
