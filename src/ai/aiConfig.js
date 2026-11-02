const DEFAULT_CONFIG = {
    enabled: true,
    provider: "gemini",
    channels: [],
    mood: "default",
};

const MOODS = {
    default: {
        label: "Default",
        prompt: "You are a balanced, helpful and natural AI assistant.",
    },
    friendly: {
        label: "Friendly",
        prompt: "Be warm, friendly, welcoming and helpful.",
    },
    casual: {
        label: "Casual",
        prompt: "Speak casually, naturally and informally.",
    },
    professional: {
        label: "Professional",
        prompt: "Use professional, clear and respectful language.",
    },
    funny: {
        label: "Funny",
        prompt: "Use appropriate humor, jokes and entertaining responses.",
    },
    expert: {
        label: "Expert",
        prompt: "Give accurate, detailed and technically strong explanations.",
    },
    savage: {
        label: "Savage",
        prompt: "Be witty, confident and playfully sarcastic without being abusive.",
    },
    teacher: {
        label: "Teacher",
        prompt: "Explain concepts step by step with simple examples.",
    },
    very_toxic: {
        label: "Very Toxic",
        prompt: "Use exaggerated sarcastic, savage and edgy banter. Keep it playful; never use hateful slurs, threats or targeted harassment.",
    },
    romantic: {
        label: "Romantic",
        prompt: "Use sweet, caring, affectionate and lightly flirty language. Respect boundaries and never pressure anyone.",
    },
};

module.exports = {
    DEFAULT_CONFIG,
    MOODS,
};