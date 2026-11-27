const { appendFileSync, mkdirSync, renameSync, rmSync, statSync } = require("node:fs");
const { resolve } = require("node:path");
const { createInterface } = require("node:readline");
const { stripVTControlCharacters } = require("node:util");
const { redactPrivateData, sanitizeSingleLine } = require("../ai/contentFilters");
const { terminal } = require("./terminal");

const maxBytes = 2 * 1024 * 1024;
const routineJavaWarning = /^(?:\[Lavalink\]\s*)?WARN(?:ING)?[:\s]+(?:a restricted method in java\.lang\.System has been called|java\.lang\.System::load has been called by|Please consider reporting this to the maintainers of|Restricted methods will be blocked in a future release)/i;
const javaOptionsLine = /^(?:NOTE:\s*)?Picked up (?:JDK_JAVA_OPTIONS|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS):/i;
const fileSizes = new Map();
const javaMessages = new Map();
let bridged = false;
let reportedFileError = false;

function secretValues(env = process.env) {
    return Object.entries(env)
        .filter(([key, value]) => value && /(?:^|_)(?:TOKEN|PASSWORD|PASSWD|SECRET|KEY|CREDENTIALS)(?:_|$)|^MONGODB_URI$|^MUSIC_MEDIA_BASE_URL$/i.test(key))
        .map(([, value]) => value.trim())
        .filter(Boolean)
        .sort((first, second) => second.length - first.length);
}

function safeText(value, secrets = secretValues(), limit = 600) {
    let text = stripVTControlCharacters(String(value ?? "")).replace(/[\u0080-\u009f]/g, "");
    for (const secret of secrets) {
        if (secret.length >= 4) {
            text = text.replaceAll(secret, "[redacted]");
        } else {
            const literal = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            text = text.replace(new RegExp(`(?<![\\w])${literal}(?![\\w])`, "g"), "[redacted]");
        }
    }
    text = text
        .replace(/\b(?:mongodb(?:\+srv)?|https?|wss?):\/\/[^\s<>"']+/gi, "[url]")
        .replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=]\s*[^\r\n]+/gi, "[redacted header]")
        .replace(/\b(?:bearer|basic)\s+[a-z0-9+/_.~=-]+/gi, "[redacted auth]")
        .replace(/\b[\w-]*(?:token|password|passwd|secret|api[_-]?key|credential)[\w-]*["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "[redacted setting]")
        .replace(/\b[A-Za-z0-9+/_=-]{48,}\b/g, "[redacted value]");
    return sanitizeSingleLine(redactPrivateData(text), limit);
}

function describe(value) {
    if (value && typeof value === "object") {
        return [value.message, value.name, value.code, value.status]
            .filter(item => typeof item === "string" || typeof item === "number").join(" ") || "[details omitted]";
    }
    return String(value ?? "");
}

function writeFile(name, entry) {
    const directory = resolve(process.env.BAUAA_LOG_DIR || resolve(__dirname, "../../music-node/logs"));
    const path = resolve(directory, name);
    const record = JSON.stringify({ ...entry, time: entry.time.toISOString() }) + "\n";
    try {
        if (!fileSizes.has(path)) mkdirSync(directory, { recursive: true, mode: 0o700 });
        let size = fileSizes.get(path) ?? statSync(path, { throwIfNoEntry: false })?.size ?? 0;
        const bytes = Buffer.byteLength(record);
        if (size + bytes > maxBytes) {
            rmSync(`${path}.1`, { force: true });
            renameSync(path, `${path}.1`);
            size = 0;
        }
        appendFileSync(path, record, { encoding: "utf8", mode: 0o600 });
        fileSizes.set(path, size + bytes);
    } catch {
        fileSizes.delete(path);
        if (reportedFileError) return;
        reportedFileError = true;
        terminal.log({
            level: "WARNING", component: "Diagnostics",
            message: "Cannot write diagnostic files. Check permissions or set BAUAA_LOG_DIR.",
        });
    }
}

function log(level, component, ...values) {
    const message = safeText(values.map(describe).join(" "));
    if (!message) return;
    const entry = { time: new Date(), level, component, message };
    if (level === "DEBUG") {
        writeFile("application.ndjson", entry);
        if (process.env.BAUAA_VERBOSE !== "1") return;
    }
    terminal.log(entry);
}

// The existing bot modules use console.*. Bridge legacy calls once at the application entry point
// so they pass through the same renderer and redaction without modifying each command and event.
function bridgeConsole() {
    if (bridged) return;
    bridged = true;
    const levels = { log: "DEBUG", debug: "DEBUG", info: "INFO", warn: "WARNING", error: "ERROR" };
    for (const [method, level] of Object.entries(levels)) {
        console[method] = (...values) => log(level, "Application", ...values);
    }
}

function javaLevel(line, stream) {
    const code = /^\s*(?:\[Lavalink\]\s*)?(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)\b/i.exec(line)?.[1].toUpperCase();
    if (javaOptionsLine.test(line) || /^\s+at\s/.test(line)) return "DEBUG";
    if (code === "ERROR" || code === "FATAL" || /^(?:Caused by:|Exception in thread)/.test(line)) return "ERROR";
    if (/\b(?:insecure|unauthenticated|(?:authentication|authorization|certificate|TLS) (?:disabled|failed|expired|invalid))\b/i.test(line)) return "WARNING";
    if (code === "WARN" || code === "WARNING") return "WARNING";
    if (code === "INFO") return "INFO";
    if (code) return "DEBUG";
    if (stream === "stderr" || /\b(?:failed|exception|unable to|authentication|security|insecure)\b/i.test(line)) return "ERROR";
    return "DEBUG";
}

function captureLavalink(child, password) {
    const secrets = [...secretValues(), ...(password ? [password] : [])].sort((a, b) => b.length - a.length);
    for (const stream of ["stdout", "stderr"]) {
        const input = child[stream];
        const lines = createInterface({ input, crlfDelay: Infinity });
        lines.on("error", error => log("WARNING", "Lavalink JVM", "Diagnostic stream failed.", error));
        lines.on("line", line => {
            line = stripVTControlCharacters(line);
            if (!line.trim()) return;
            const level = javaLevel(line, stream);
            const message = javaOptionsLine.test(line)
                ? "Java runtime options were supplied through the environment."
                : safeText(line.replace(/^(?:\[Lavalink\]\s*)?(?:TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL)[:\s]+/i, ""), secrets, 4000);
            const entry = { time: new Date(), level, component: "Lavalink JVM", stream, message };
            writeFile("lavalink.ndjson", entry);
            if (process.env.BAUAA_VERBOSE === "1") {
                terminal.log(entry);
            } else if ((level === "WARNING" && !routineJavaWarning.test(line)) || level === "ERROR") {
                const key = `${level}:${message}`;
                const now = Date.now();
                if (now - (javaMessages.get(key) || 0) < 30_000) return;
                if (javaMessages.size >= 100) javaMessages.clear();
                javaMessages.set(key, now);
                terminal.log({ ...entry, message: message.slice(0, 600) });
            }
        });
    }
}

module.exports = { bridgeConsole, captureLavalink, log, safeText };
