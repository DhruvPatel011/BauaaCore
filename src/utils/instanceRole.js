function getInstanceRole(env = process.env) {
    const configured = env.BAUAA_INSTANCE_ROLE?.trim();
    if (configured) {
        if (!["all", "general", "music"].includes(configured)) {
            throw new Error("BAUAA_INSTANCE_ROLE must be all, general, or music.");
        }
        return configured;
    }

    const audioNodeConfigured = (env.LAVALINK_URL?.trim() && env.LAVALINK_PASSWORD) ||
        (env.LAVALINK_URL_BACKUP?.trim() && env.LAVALINK_PASSWORD_BACKUP);
    if (env.RENDER === "true" && !audioNodeConfigured) return "general";
    return "all";
}

function handlesCommand(role, isMusic) {
    return role === "all" || role === (isMusic ? "music" : "general");
}

module.exports = { getInstanceRole, handlesCommand };
