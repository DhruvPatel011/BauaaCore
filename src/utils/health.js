const { getDatabase } = require("../config/database");

const DATABASE_TIMEOUT_MS = 1_000;
const DATABASE_CHECK_TTL_MS = 5_000;
const AUDIO_RESTART_GRACE_MS = 60_000;

function sendJson(res, code, body) {
    res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    return res.end(JSON.stringify(body));
}

async function pingDatabase() {
    try {
        await getDatabase().command({ ping: 1 }, { timeoutMS: DATABASE_TIMEOUT_MS });
        return "connected";
    } catch {
        return "unavailable";
    }
}

function createHealthHandler(client, instanceRole, { audioStatus, waitForInitialAudio = false, isDraining = () => false } = {}) {
    let check;
    let audioLastConnected;
    function currentAudio() {
        const audio = audioStatus?.();
        if (audio === "connected") audioLastConnected = Date.now();
        return audio;
    }
    return async (req, res) => {
        let path;
        try {
            const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
            path = url.pathname.replace(/\/+$/, "") || "/";
        } catch {
            return sendJson(res, 400, { error: "Bad Request" });
        }

        if (path === "/" || path === "/health") {
            const audio = currentAudio();
            return sendJson(res, 200, {
                service: "BauaaCore",
                status: "running",
                instanceRole,
                discord: client.isReady() ? "connected" : "disconnected",
                audio,
                uptime: Math.floor(process.uptime()),
                timestamp: new Date().toISOString(),
            });
        }

        if (path === "/ready") {
            let discordConnected = client.isReady();
            let database = "unchecked";
            if (discordConnected) {
                if (!check || check.expires <= Date.now()) {
                    check = { result: pingDatabase(), expires: Date.now() + DATABASE_CHECK_TTL_MS };
                }
                database = await check.result;
                discordConnected = client.isReady();
            }
            const audio = currentAudio();
            const audioReady = !waitForInitialAudio ||
                (audioLastConnected !== undefined && Date.now() - audioLastConnected < AUDIO_RESTART_GRACE_MS);
            const ready = !isDraining() && discordConnected && database === "connected" && audioReady;
            return sendJson(res, ready ? 200 : 503, {
                service: "BauaaCore",
                status: ready ? "ready" : "not_ready",
                instanceRole,
                discord: discordConnected ? "connected" : "disconnected",
                database,
                audio,
                timestamp: new Date().toISOString(),
            });
        }

        return sendJson(res, 404, { error: "Not Found", path });
    };
}

module.exports = { createHealthHandler };
