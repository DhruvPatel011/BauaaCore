const { version } = require("../../package.json");
const { sanitizeSingleLine } = require("../ai/contentFilters");

const colors = { WAIT: 96, READY: 92, INFO: 94, WARN: 93, ERROR: 91 };
let bannerShown = false;

function interactive(stream) {
    return stream.isTTY && process.env.TERM !== "dumb";
}

function color(stream, code, text) {
    if (!interactive(stream) || process.env.NO_COLOR || process.env.FORCE_COLOR === "0") return text;
    return `\x1b[${code}m${text}\x1b[0m`;
}

function status(level, component, message) {
    const warning = level === "WARN" || level === "ERROR";
    const stream = warning ? process.stderr : process.stdout;
    const print = warning ? console.error : console.log;
    const detail = sanitizeSingleLine(message);

    if (!interactive(stream) || stream.columns < 45) {
        print(`[${component}] ${level} ${detail}`);
        return;
    }

    const time = new Date().toTimeString().slice(0, 8);
    const badge = color(stream, colors[level], level.padEnd(5));
    print(`${color(stream, 90, time)}  ${badge}  ${component.padEnd(10)}  ${detail}`);
}

function banner(role) {
    if (bannerShown) return;
    bannerShown = true;

    const stream = process.stdout;
    const title = `BauaaCore  v${version}`;
    const details = `Role ${role}  /  Ctrl+C to stop`;
    const width = Math.max(title.length, details.length);
    if (!interactive(stream) || stream.columns < width + 6) {
        status("INFO", "BauaaCore", `v${version} · role ${role}`);
        return;
    }

    const edge = text => color(stream, 96, text);
    const row = (text, code) => `${edge("│")}  ${color(stream, code, text.padEnd(width))}  ${edge("│")}`;
    console.log([
        "",
        edge(`╭${"─".repeat(width + 4)}╮`),
        row(title, "1;95"),
        row(details, "0"),
        edge(`╰${"─".repeat(width + 4)}╯`),
        "",
    ].join("\n"));
}

module.exports = { banner, status };
