const { spawn, spawnSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const javaEnv = { ...process.env };
process.chdir(join(__dirname, ".."));
require("dotenv").config({ quiet: true });

function javaExecutable() {
    if (process.platform !== "win32") return "java";

    // The Oracle PATH shim starts a second process. Launch the JVM directly so it stops with the bot.
    const result = spawnSync("java", ["-XshowSettings:properties", "-version"], {
        encoding: "utf8",
        env: javaEnv,
        windowsHide: true,
    });
    if (result.error?.code === "ENOENT") throw new Error("Java is missing from PATH.");
    const javaHome = result.stderr?.match(/^\s*java\.home\s*=\s*(.+)$/m)?.[1].trim();
    if (!javaHome) throw new Error("Could not locate the Java runtime on PATH.");
    return join(javaHome, "bin", "java.exe");
}

async function lavalinkReady(url, password) {
    const response = await fetch(new URL("/v4/info", url), {
        headers: { Authorization: password },
        redirect: "error",
        signal: AbortSignal.timeout(1000),
    }).catch(() => null);
    if (!response) return false;
    await response.body?.cancel();
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
    throw new Error("Lavalink did not become ready within 60 seconds.");
}

async function start() {
    const url = new URL(process.env.LAVALINK_URL || "http://127.0.0.1:2333");
    const password = process.env.LAVALINK_PASSWORD;
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
        throw new Error("Set LAVALINK_URL to a local HTTP origin for this launcher.");
    }
    if (!process.env.DISCORD_TOKEN || !process.env.MONGODB_URI || !password) {
        throw new Error("Set DISCORD_TOKEN, MONGODB_URI and LAVALINK_PASSWORD in .env.");
    }

    if (!(await lavalinkReady(url, password))) {
        const cwd = join(process.cwd(), "music-node");
        if (!existsSync(join(cwd, "Lavalink.jar"))) {
            throw new Error("Lavalink.jar is missing from music-node.");
        }
        const pluginFiles = readFileSync(join(cwd, "plugins.sha256"), "utf8").trim().split(/\r?\n/)
            .map(line => line.trim().split(/\s+/)[1]);
        const bundledPlugins = pluginFiles.every(file => file && existsSync(join(cwd, "plugins", file)));
        const args = ["-jar", "Lavalink.jar", "--debug=false"];
        if (bundledPlugins) {
            // Use the existing preloaded-plugin profile to skip Maven update checks.
            args.push("--spring.profiles.active=render");
        }
        const child = spawn(javaExecutable(), args, {
            cwd,
            env: {
                ...javaEnv,
                LAVALINK_PASSWORD: password,
                SERVER_ADDRESS: "127.0.0.1",
                SERVER_PORT: url.port || "80",
            },
            stdio: "inherit",
        });
        process.once("exit", () => child.kill());
        const stopped = new Promise((_, reject) => {
            child.once("error", error => reject(new Error(
                error.code === "ENOENT" ? "Java is missing from PATH." : `Could not start Java (${error.code}).`
            )));
            child.once("exit", (code, signal) => reject(new Error(`Lavalink exited (${signal || code}).`)));
        });
        const stopStartup = () => process.exit(130);
        process.once("SIGINT", stopStartup);
        process.once("SIGTERM", stopStartup);
        try {
            await Promise.race([waitForLavalink(url, password), stopped]);
        } finally {
            process.off("SIGINT", stopStartup);
            process.off("SIGTERM", stopStartup);
        }
    }

    console.log("Local Lavalink is ready. Starting BauaaCore in music mode.");
    process.env.BAUAA_INSTANCE_ROLE = "music";
    require("../src/index");
}

start().catch(error => {
    console.error(error.message);
    process.exit(1);
});
