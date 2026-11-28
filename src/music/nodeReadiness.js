async function probeLavalink(url, password, signal = AbortSignal.timeout(1_000)) {
    const response = await fetch(new URL("/v4/info", url), {
        headers: { Authorization: password },
        redirect: "error",
        signal,
    }).catch(() => null);
    await response?.body?.cancel().catch(() => {});
    return response;
}

module.exports = { probeLavalink };
