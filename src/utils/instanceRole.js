function getInstanceRole(env = process.env) {
    const configured = env.BAUAA_INSTANCE_ROLE?.trim();
    if (configured) {
        if (!["all", "general", "music"].includes(configured)) {
            throw new Error("BAUAA_INSTANCE_ROLE must be all, general, or music.");
        }
        return configured;
    }

    return "all";
}

function handlesCommand(role, isMusic) {
    return role === "all" || role === (isMusic ? "music" : "general");
}

module.exports = { getInstanceRole, handlesCommand };
