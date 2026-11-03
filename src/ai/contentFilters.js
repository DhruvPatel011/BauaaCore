"use strict";

/**
 * Content filters shared by long-term memory and custom instructions.
 * These are heuristics, not a guarantee: they reduce the chance of storing
 * secrets / sensitive data or persisting prompt-injection text.
 */

const CONTROL_CHARS =
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

function stripControlChars(input) {
    return String(input ?? "").replace(CONTROL_CHARS, "");
}

function sanitizeSingleLine(input, maxLength = Infinity) {
    let text = stripControlChars(input).replace(/\s+/g, " ").trim();

    if (text.length > maxLength) {
        text = text.slice(0, maxLength).trim();
    }

    return text;
}

const SECRET_PATTERNS = [
    ["a secret or credential", /\b(?:api[\s_-]?key|secret|token|passw(?:or)?d|passcode|otp|cvv|private key|seed phrase|credentials?)\b/i],
    ["a secret or credential", /\b(?:sk|gsk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{8,}/i],
    ["a database connection string", /\bmongodb(?:\+srv)?:\/\//i],
    ["a secret or credential", /\bbearer\s+[A-Za-z0-9._-]{10,}/i],
    ["a long token-like string", /[A-Za-z0-9+/_=-]{32,}/],
    ["a card or ID number", /\b(?:\d[ -]?){13,19}\b/],
    ["a card or ID number", /\b\d{4}\s?\d{4}\s?\d{4}\b/],
    ["a card or ID number", /\b[A-Z]{5}\d{4}[A-Z]\b/],
    ["an email address", /[^\s@]+@[^\s@]+\.[A-Za-z]{2,}/],
    ["a phone number", /(?:\+?\d[\s-]?){10,}/],
];

const SENSITIVE_PATTERNS = [
    ["health information", /\b(?:diagnos\w*|disease|illness|cancer|diabet\w*|hiv|depress\w*|anxiety|bipolar|adhd|autis\w*|medication|medicine|therapy|therapist|suicid\w*|self[- ]harm|pregnan\w*|disabilit\w*|bimari)\b/i],
    ["religion, caste or politics", /\b(?:religio\w*|dharm|muslim|hindu|christian|sikh|jewish|buddhist|atheis\w*|caste|jaati|jati|dalit|brahmin|politic\w*|bjp|congress)\b/i],
    ["sexual or relationship-private information", /\b(?:gay|lesbian|bisexual|transgender|sexual\w*|orientation)\b/i],
    ["financial or immigration details", /\b(?:salary|debt|bank account|immigration|visa status)\b/i],
];

const INJECTION_PATTERNS = [
    ["an attempt to override instructions", /\b(?:ignore|forget|disregard|override|bypass)\b.{0,40}\b(?:instruction|rule|prompt|polic(?:y|ies)|guideline|restriction)s?\b/i],
    ["an attempt to access the system prompt", /\b(?:system\s*prompt|developer\s*message|jailbreak|dan mode)\b/i],
    ["an attempt to change the AI's identity or limits", /\byou are now\b|\bact as (?:an? )?(?:unrestricted|jailbroken|uncensored)\b|\bno (?:restrictions|filters|rules|limits)\b/i],
    ["an attempt to extract hidden data", /\b(?:reveal|show|print|leak|expose)\b.{0,30}\b(?:prompt|instructions?|api key|token|secret)s?\b/i],
    ["an instruction to suppress honesty", /\b(?:always|never)\s+(?:agree|disagree|correct|criticize|criticise|refuse)\b|\b(?:never|don'?t|do not)\s+(?:say|admit|mention)\b.{0,30}\b(?:uncertain|unsure|don'?t know|mistake|wrong)\b/i],
];

function firstMatch(table, text) {
    const value = String(text ?? "");

    for (const [label, regex] of table) {
        if (regex.test(value)) return label;
    }

    return null;
}

function findSecret(text) {
    return firstMatch(SECRET_PATTERNS, text);
}

function findSensitive(text) {
    return firstMatch(SENSITIVE_PATTERNS, text);
}

function findInjection(text) {
    return firstMatch(INJECTION_PATTERNS, text);
}

module.exports = {
    stripControlChars,
    sanitizeSingleLine,
    findSecret,
    findSensitive,
    findInjection,
};
