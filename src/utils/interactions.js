const { MessageFlags, REST } = require("discord.js");
const discordEpoch = 1_420_070_400_000;

function limitInteractionCallbacks(rest, callbacks = new REST({ ...rest.options, retries: 0, rejectOnRateLimit: ["/interactions"] })) {
    const post = rest.post.bind(rest);
    rest.post = (route, options) => {
        const match = /^\/interactions\/(\d+)\/[^/]+\/callback$/.exec(route);
        if (!match) return post(route, options);
        const remaining = Number(BigInt(match[1]) >> 22n) + discordEpoch + 3_000 - Date.now();
        if (remaining <= 0) return Promise.reject(Object.assign(new Error("Expired interaction"), { code: 10062 }));
        return callbacks.post(route, { ...options, signal: AbortSignal.timeout(remaining) });
    };
}

function endedInteraction(error) {
    return [10062, 40060, "InteractionAlreadyReplied"].includes(error?.code);
}

// Reserve locally before the first await. Discord's callback is the arbiter if
// two gateway sessions are present during a rollout.
function interactionDispatcher({ onError, onAcknowledge }) {
    const seen = new Set();
    return async (interaction, execute) => {
        if (seen.has(interaction.id)) return;
        seen.add(interaction.id);
        setTimeout(() => seen.delete(interaction.id), 60_000).unref();
        if (Date.now() - interaction.createdTimestamp >= 3_000) {
            onError("Interaction arrived after its acknowledgement deadline", undefined, interaction);
            return;
        }

        // A rejected initial callback can already have reached Discord. Never
        // issue another initial callback after any such failure.
        let attempted = false;
        let attemptedCompletion = false;
        for (const method of ["deferReply", "reply", "deferUpdate", "update", "showModal"]) {
            if (typeof interaction[method] !== "function") continue;
            const original = interaction[method].bind(interaction);
            interaction[method] = async (...args) => {
                if (attempted) return Promise.reject(Object.assign(new Error("Initial response already attempted"), { code: "InteractionAlreadyReplied" }));
                attempted = true;
                const result = await original(...args);
                onAcknowledge?.(interaction);
                return result;
            };
        }
        for (const method of ["editReply", "followUp"]) {
            if (typeof interaction[method] !== "function") continue;
            const original = interaction[method].bind(interaction);
            interaction[method] = (...args) => {
                attemptedCompletion = true;
                return original(...args);
            };
        }

        try {
            await execute(interaction);
        } catch (error) {
            if (endedInteraction(error)) {
                if (error.code === 10062) onError("Discord rejected acknowledgement", error, interaction);
                return;
            }
            onError("Handler failed", error, interaction);
            if (attemptedCompletion) return;
            const content = "An error occurred while handling this interaction.";
            try {
                if (interaction.deferred && interaction.isChatInputCommand()) await interaction.editReply({ content });
                else if (interaction.deferred || interaction.replied) await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
                else if (!attempted && Date.now() - interaction.createdTimestamp < 3_000) await interaction.reply({ content, flags: MessageFlags.Ephemeral });
            } catch (replyError) {
                if (!endedInteraction(replyError)) onError("Error response failed", replyError, interaction);
            }
        }
    };
}

module.exports = { interactionDispatcher, limitInteractionCallbacks };
