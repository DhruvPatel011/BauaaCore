const { performance } = require("node:perf_hooks");
const stringWidth = require("string-width");
const { version } = require("../../package.json");

const services = {
    lavalink: "Lavalink",
    http: "HTTP Server",
    mongodb: "MongoDB",
    discord: "Discord Gateway",
    audio: "Audio Node",
};
const settled = new Set(["ready", "skipped", "warning", "failed"]);
const art = [
    " ____                            ____               ",
    "| __ )  __ _ _   _  __ _  __ _  / ___|___  _ __ ___ ",
    "|  _ \\ / _` | | | |/ _` |/ _` | |   / _ \\| '__/ _ \\",
    "| |_) | (_| | |_| | (_| | (_| | |__| (_) | | |  __/",
    "|____/ \\__,_|\\__,_|\\__,_|\\__,_| \\____\\___/|_|  \\___|",
];
const palettes = {
    dark: { cyan: "48;219;234", purple: "184;133;255", green: "58;218;158", gray: "157;170;188", amber: "255;195;103", red: "255;123;139" },
    light: { cyan: "0;106;125", purple: "109;43;194", green: "0;116;79", gray: "86;99;117", amber: "148;85;0", red: "174;34;59" },
    standard: { cyan: 36, purple: 35, green: 32, gray: 90, amber: 33, red: 31 },
};
const logColors = { INFO: "cyan", SUCCESS: "green", WARNING: "amber", ERROR: "red", DEBUG: "gray" };
const logIcons = { INFO: "›", SUCCESS: "✓", WARNING: "!", ERROR: "×", DEBUG: "·" };
const renderLevels = { SUCCESS: "READY", WARNING: "WARN", DEBUG: "INFO" };
const renderComponents = { "HTTP Server": "HTTP", "Discord Gateway": "Discord", "Audio Node": "Lavalink" };
const states = {
    ready: ["✓", "+", "green", "Ready"],
    skipped: ["−", "-", "gray", "Skipped"],
    warning: ["!", "!", "amber", "Attention"],
    failed: ["×", "x", "red", "Failed"],
    working: ["◌", "*", "cyan", "Interrupted"],
    pending: ["·", "-", "gray", "Not started"],
};

function duration(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s`;
}

function usesRenderLogs(env = process.env) {
    return env.RENDER === "true" || env.BAUAA_RENDER_LOGS === "1";
}

function createTerminal({ out = process.stdout, err = process.stderr, env = process.env, now = () => performance.now(),
    uptime = () => process.uptime() * 1000 } = {}) {
    const render = usesRenderLogs(env);
    const interactive = () => Boolean(!render && out.isTTY && err.isTTY && env.TERM !== "dumb" && env.BAUAA_PLAIN !== "1");
    const unicode = env.BAUAA_ASCII !== "1" && env.TERM !== "dumb";
    const width = () => Math.min(out.columns || 80, 88) - 1;
    const colorsEnabled = () => interactive() && !env.NO_COLOR && env.FORCE_COLOR !== "0";
    const background = env.COLORFGBG?.split(";").pop();
    const theme = env.BAUAA_THEME || (background !== undefined && (Number(background) === 7 || Number(background) >= 15) ? "light" : "dark");
    const palette = palettes[theme] || palettes.dark;
    const sgr = (text, code) => `\x1b[${code}m${text}\x1b[0m`;
    const paint = (text, tone, stream = out) => {
        if (!colorsEnabled()) return text;
        const trueColor = stream.hasColors?.(2 ** 24, env);
        const code = trueColor ? `38;2;${palette[tone]}` : palettes.standard[tone];
        return sgr(text, code);
    };
    const displayText = text => unicode ? text : text.normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^\x20-\x7e]/gu, "?");
    const graphemes = new Intl.Segmenter();
    const separator = unicode ? " · " : " | ";
    const rows = new Map(Object.keys(services).map(id => [id, { state: "pending" }]));
    let role;
    let phase = "idle";
    let timer;
    let drawn = false;
    let frame = 0;
    let shutdownAt;
    let shutdownLabel;

    function fit(text, limit) {
        if (stringWidth(text) <= limit) return text;
        const tail = unicode ? "…" : "...";
        let cells = stringWidth(tail);
        let head = "";
        for (const { segment } of graphemes.segment(text)) {
            cells += stringWidth(segment);
            if (cells > limit) break;
            head += segment;
        }
        return head + tail;
    }

    function gradient(line, index) {
        if (!colorsEnabled() || !out.hasColors?.(2 ** 24, env)) {
            return paint(line, index < 2 ? "cyan" : "purple");
        }
        const start = palette.cyan.split(";").map(Number);
        const end = palette.purple.split(";").map(Number);
        return (line.match(/.{1,4}/g) || []).map((chunk, column) => {
            const blend = (column * 4 + index * 3) / (line.length + art.length * 3);
            const color = start.map((channel, i) => Math.round(channel + (end[i] - channel) * blend)).join(";");
            return sgr(chunk, `38;2;${color}`);
        }).join("");
    }

    function clearLine() {
        if (drawn) out.write("\r\x1b[2K");
        drawn = false;
    }

    function animate() {
        if (!interactive() || width() < 34) {
            clearLine();
            return;
        }
        const spinner = unicode ? [..."⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"] : ["-", "\\", "|", "/"];
        const mark = paint(spinner[frame++ % spinner.length], "cyan");
        let line;
        if (phase === "shutdown") {
            const elapsed = duration(now() - shutdownAt);
            line = `  ${mark}  ${fit(shutdownLabel, width() - elapsed.length - 7)}  ${paint(elapsed, "gray")}`;
        } else {
            const finished = [...rows.values()].filter(row => settled.has(row.state)).length;
            const ratio = finished / rows.size;
            const size = width() >= 54 ? 20 : width() >= 40 ? 10 : 6;
            const filled = Math.round(size * ratio);
            const bar = paint((unicode ? "━" : "=").repeat(filled), "green") +
                paint((unicode ? "─" : "-").repeat(size - filled), "gray");
            const current = [...rows].find(([, row]) => row.state === "working");
            const label = current ? services[current[0]] : finished === rows.size ? "Finalizing" : "Starting";
            line = `  ${mark}  ${bar}  ${String(Math.round(ratio * 100)).padStart(3)}%  ${label}`;
        }
        out.write(`\r\x1b[2K${line}`);
        drawn = true;
    }

    function startAnimation() {
        if (!interactive()) return;
        animate();
        timer = setInterval(animate, 100);
        timer.unref();
    }

    function stopAnimation() {
        clearInterval(timer);
        timer = undefined;
        clearLine();
    }

    function log({ time = new Date(), level, component, message }) {
        const stream = level === "WARNING" || level === "ERROR" ? err : out;
        const detail = displayText(message);
        if (render) {
            const label = renderComponents[component] || component;
            const status = renderLevels[level] || level;
            const prefix = component === "Application" ? "" :
                component === "Music" && (level === "INFO" || level === "SUCCESS") ? "[Music] " : `[${label}] ${status} `;
            stream.write(`${prefix}${detail}\n`);
            return;
        }
        clearLine();
        if (interactive()) {
            const clock = paint(time.toTimeString().slice(0, 8), "gray", stream);
            const icon = unicode ? logIcons[level] : level === "ERROR" || level === "WARNING" ? "!" : ">";
            const badge = paint(`${icon} ${level.padEnd(7)}`, logColors[level], stream);
            stream.write(`  ${clock}  ${badge}  ${component}${separator}${detail}\n`);
        } else {
            stream.write(`${time.toISOString()}  ${level}  [${component}] ${detail}\n`);
        }
        if (timer && (phase === "startup" || phase === "shutdown")) animate();
    }

    function begin(instanceRole) {
        if (phase !== "idle") return;
        role = instanceRole;
        phase = "startup";
        if (!interactive()) {
            log({ level: "INFO", component: "BauaaCore", message: `v${version}${render ? separator : " | "}role ${role}` });
        } else {
            const name = width() >= 57
                ? art.map((line, index) => `  ${gradient(line.trimEnd(), index)}`).join("\n")
                : `  ${paint("BauaaCore", "cyan")}`;
            out.write(`\n${name}\n  ${paint(`v${version}`, "purple")}${separator}Role ${role}${separator}${paint("Ctrl+C to stop", "gray")}\n\n`);
        }
        startAnimation();
    }

    function stage(id, state, detail = "") {
        const row = rows.get(id);
        if (phase !== "startup" || settled.has(row.state)) return false;
        if (state === "working") row.started ??= now();
        if (settled.has(state) && row.started !== undefined) row.elapsed = now() - row.started;
        row.state = state;
        row.detail = detail;
        if (render) {
            if (state === "skipped" || (id === "http" && state === "working") || (id === "audio" && state === "ready")) return true;
            const level = state === "working" ? "WAIT" : state === "ready" ? "SUCCESS" : state === "warning" ? "WARNING" : "ERROR";
            log({ level, component: services[id], message: detail });
            return true;
        }
        if (!interactive() || state === "failed" || state === "warning") {
            const level = state === "ready" ? "SUCCESS" : state === "failed" ? "ERROR" : state === "warning" ? "WARNING" : "INFO";
            const timing = row.elapsed === undefined ? "" : ` (${duration(row.elapsed)})`;
            log({ level, component: services[id], message: `${detail || states[state][3]}${timing}` });
        } else {
            animate();
        }
        return true;
    }

    function serviceLines() {
        const lines = Object.entries(services).map(([id, label]) => {
            const row = rows.get(id);
            const [icon, ascii, tone, name] = states[row.state];
            const ms = row.elapsed ?? (row.started === undefined ? undefined : now() - row.started);
            const timing = ms === undefined ? "-" : duration(ms);
            const mark = paint(unicode ? icon : ascii, tone);
            if (width() < 46) return `  ${mark} ${label}  ${paint(name, tone)}  ${paint(timing, "gray")}`;
            const detail = row.detail && width() >= 66 && !["warning", "failed"].includes(row.state)
                ? paint(fit(row.detail, width() - 46), "gray") : "";
            return `  ${mark}  ${label.padEnd(16)}  ${paint(name.padEnd(11), tone)}  ${paint(timing.padStart(7), "gray")}  ${detail}`.trimEnd();
        });
        const heading = width() >= 46 ? "  Services".padEnd(23) + "Status".padEnd(14) + "Time" : "  Services";
        return [paint(heading, "gray"), ...lines];
    }

    function box(title, lines, tone) {
        const lineWidth = Math.max(title.length + 2, ...lines.map(line => stringWidth(line)));
        if (lineWidth + 8 > width()) return [`  ${paint(title, tone)}`, ...lines.map(line => `  ${line}`)].join("\n");
        const [tl, tr, bl, br, h, v] = unicode ? [..."╭╮╰╯─│"] : ["+", "+", "+", "+", "-", "|"];
        const edge = text => paint(text, tone);
        return [
            `  ${edge(tl + h + " " + title + " " + h.repeat(lineWidth - title.length + 1) + tr)}`,
            ...lines.map(line => `  ${edge(v)}  ${line + " ".repeat(lineWidth - stringWidth(line))}  ${edge(v)}`),
            `  ${edge(bl + h.repeat(lineWidth + 4) + br)}`,
        ].join("\n");
    }

    function complete(metrics) {
        if (phase !== "startup" || [...rows.values()].some(row => !settled.has(row.state))) return;
        phase = "running";
        stopAnimation();
        if (render) return;
        const attention = [...rows.values()].some(row => ["warning", "failed"].includes(row.state));
        const title = attention ? "Startup complete with warnings" : "Startup complete";
        const bot = displayText(metrics.bot);
        const details = [
            `Version   v${version}`.padEnd(24) + `Uptime    ${duration(uptime())}`,
            `Servers   ${metrics.servers}`.padEnd(24) + `Commands  ${metrics.commands}`,
            `HTTP      ${metrics.port}`.padEnd(24) + `Audio     ${metrics.audio}`,
        ];
        if (!interactive()) {
            log({ level: attention ? "WARNING" : "SUCCESS", component: "Startup",
                message: `${title} (100%) | ${bot} | ${details.map(line => line.trim().replace(/ {2,}/g, " ")).join(" | ")}` });
            return;
        }
        const tone = attention ? "amber" : "green";
        const titleLine = `${title} / 100%`;
        const botWidth = width() >= 46 ? Math.min(48, width() - 8) : Math.max(width() - 3, 24);
        const wrappedDetails = width() >= 54 ? details : details.flatMap(line => [line.slice(0, 24).trimEnd(), line.slice(24)]);
        const dashboard = [`Bot       ${fit(bot, botWidth - 10)}`, ...wrappedDetails];
        out.write(`${serviceLines().join("\n")}\n\n${box(titleLine, dashboard, tone)}\n\n`);
    }

    function abort() {
        if (phase === "shutdown") {
            phase = "stopped";
            stopAnimation();
            return;
        }
        if (phase !== "startup") return;
        phase = "stopping";
        stopAnimation();
        if (interactive()) out.write(`${serviceLines().join("\n")}\n\n`);
    }

    function beginShutdown(label = "Closing services") {
        abort();
        phase = "shutdown";
        shutdownAt = now();
        shutdownLabel = label;
        if (!interactive()) log({ level: "INFO", component: "Shutdown", message: label });
        startAnimation();
    }

    function finishShutdown(success, message) {
        phase = "stopped";
        stopAnimation();
        const elapsed = render || shutdownAt === undefined ? "" : ` (${duration(now() - shutdownAt)})`;
        log({ level: success ? (render ? "INFO" : "SUCCESS") : "ERROR", component: "Shutdown", message: `${message}${elapsed}` });
    }

    return { begin, stage, log, complete, abort, beginShutdown, finishShutdown };
}

const terminal = createTerminal();
module.exports = { createTerminal, terminal, usesRenderLogs };
