"use strict";

const EXPLICIT_SEARCH = /\b(?:web search|search (?:the web|online|google)|look (?:it |this |that )?up online|check (?:online|the web)|(?:google|internet|web) (?:pe|par|se) (?:search|check|dhundh?o|dekho))\b|ऑनलाइन (?:खोजो|देखो)|ઇન્ટરનેટ પર શોધો/iu;
const FRESHNESS = /\b(?:latest|trending|current(?:ly)?|breaking|right now|today(?:'s)?|yesterday|this (?:week|month|year)|recent(?:ly)?|newest|aaj(?: ka| ki| ke)?|abhi|filhaal|is (?:hafte|mahine|saal))\b|आज|अभी|ताज़ा|नवीनतम|इस हफ़्ते|આજે|અત્યારે|તાજા|આ અઠવાડિયે/iu;
const DATED_LOOKUP = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}\b/i;
const LOOKUP = /\b(?:what|who|which|when|where|how much|tell|show|give|find|suggest|list|recommend|update|news|songs?|chart|rank(?:ing)?s?|prices?|score|weather|version|ranking|batao|btao|dikhao|kya|kaun|kitna|kitni|list karo)\b|क्या|कौन|बताओ|गाने|खबर|समाचार|શું|કોણ|જણાવો|ગીતો|સમાચાર/iu;
const LIVE_FACT = /\b(?:weather forecast|weather (?:in|at|for)|live scores?|exchange rates?|stock prices?|breaking news|who (?:is|are)\b.{0,50}\b(?:president|prime minister|ceo|governor|chief minister)|(?:score|result)\s+(?:of|for)\s+(?:the\s+)?(?:match|game))\b/iu;
const CLOCK_ONLY = /^(?:please\s+)?(?:(?:what(?:'s| is)\s+)?(?:the\s+)?(?:current\s+)?(?:time|date|day|month|year)(?:\s+is it|\s+today|\s+now|\s+in india)?|(?:what|which) (?:day|date|month|year) is (?:it|today)|(?:aaj|abhi)\s+(?:date|time|din)\s+kya hai)[.!?\s]*$/iu;
const FOLLOW_UP = /^(?:but\b|what about\b|and\s|aur\b|lekin\b|par\b|ye sab\b|only\b|sirf\b)|\b(?:latest one|that list|same chart|these (?:songs|results)|last (?:list|answer))\b|लेकिन|वही सूची|પણ|એ જ યાદી/iu;
const BROWSER_CITATION = /[【〖](\d+)†[^】〗\r\n]+[】〗]/gu;
const MUSIC_CHART = /\b(?:songs?|tracks?|music)\b|गाने|गीत|ગીતો/iu;
const CHART_INTENT = /\b(?:chart|top\s*\d*|trending|most[- ]played)\b|चार्ट|ટ્રેન્ડિંગ/iu;
const INDIA = /\b(?:india|indian|bharat)\b|भारत|ભારત/iu;
const APPLE_INDIA_CHART = "https://music.apple.com/in/new/top-charts/songs";
const APPLE_CHART_DATA = /<script\b[^>]*\bid="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/i;
const CHART_QUALIFIERS = /\b(?:spotify|youtube|gaana|jiosaavn|amazon music|billboard|viral|weekly|yesterday|last (?:week|month|year)|20\d{2}|releases?|bollywood|punjabi|tamil|telugu|gujarati|hindi songs)\b/iu;
const CHART_CHECKED = {
    hinglish: ["en-IN", "Chart check kiya"],
    english: ["en-IN", "Chart checked"],
    hindi: ["hi-IN", "चार्ट देखा गया"],
    gujarati: ["gu-IN", "ચાર્ટ તપાસ્યો"],
};
const CHART_URLS = {
    spotify: /^https:\/\/charts\.spotify\.com\/charts\/view\/(?:regional|viral)-/i,
    apple: /^https:\/\/music\.apple\.com\/[a-z]{2}\/(?:new\/top-charts|playlist\/top-(?:25|100)-)/i,
    youtube: /^https:\/\/charts\.youtube\.com\//i,
};
const INDIA_CHART_URLS = {
    spotify: /^https:\/\/charts\.spotify\.com\/charts\/view\/(?:regional|viral)-in-/i,
    apple: /^https:\/\/music\.apple\.com\/in\/(?:new\/top-charts|playlist\/top-(?:25|100)-)/i,
    youtube: /^https:\/\/charts\.youtube\.com\//i,
};
const REPLY_LABELS = {
    hinglish: ["Search sources", "Main is request ki live information verify nahi kar paayi."],
    english: ["Search sources", "I couldn't verify current information for this request."],
    hindi: ["खोज के स्रोत", "मैं इस अनुरोध की ताज़ा जानकारी सत्यापित नहीं कर पाई।"],
    gujarati: ["શોધના સ્રોત", "હું આ વિનંતીની તાજી માહિતી ચકાસી શકી નથી."],
};

function isLiveLookup(message) {
    return !CLOCK_ONLY.test(message) && (EXPLICIT_SEARCH.test(message) || LIVE_FACT.test(message) ||
        (LOOKUP.test(message) && (FRESHNESS.test(message) || DATED_LOOKUP.test(message))));
}

// Only carry the immediately preceding public lookup into a related follow-up.
function getLiveSearchHistory(message, history) {
    const previous = history.findLast(item => item.role === "user");
    const previousText = previous?.parts?.[0]?.text || "";
    const recentLookup = previousText && isLiveLookup(previousText);
    const followUp = recentLookup && !CLOCK_ONLY.test(message) &&
        (FOLLOW_UP.test(message) || (message.length <= 80 && FRESHNESS.test(message) && !LOOKUP.test(message)));

    if (followUp) return [previous];
    return isLiveLookup(message) ? [] : null;
}

function getChartSources(query) {
    if (!MUSIC_CHART.test(query) || !CHART_INTENT.test(query)) return [];
    const india = INDIA.test(query);
    const urls = india ? INDIA_CHART_URLS : CHART_URLS;
    const platforms = [...query.matchAll(/\b(spotify|apple music|youtube)\b/gi)];
    const platform = platforms.at(-1)?.[1].toLowerCase().split(" ")[0];
    if (platform) return [urls[platform]];
    return india ? [urls.spotify, urls.apple] : [];
}

function getSourceUrl(result) {
    try {
        const url = new URL(result.url);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
        url.hash = "";
        return url.href;
    } catch {
        return null;
    }
}

function getIndiaMusicChartLimit(query) {
    if (!INDIA.test(query) || !MUSIC_CHART.test(query) || !CHART_INTENT.test(query) || CHART_QUALIFIERS.test(query)) {
        return 0;
    }
    const count = Number(query.match(/\btop\s*(\d+)\b/i)?.[1] ?? 10);
    return count > 0 && count <= 50 ? count : 0;
}

async function fetchIndiaMusicChart(count, language, signal) {
    try {
        const response = await fetch(APPLE_INDIA_CHART, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        });
        if (!response.ok) return null;
        const serialized = (await response.text()).match(APPLE_CHART_DATA)?.[1];
        if (!serialized) return null;
        const sections = JSON.parse(serialized).data?.[0]?.data?.sections;
        const items = sections?.find(section => section.id === "most-played")?.items;
        if (!Array.isArray(items) || items.length < count) return null;

        const rows = [];
        for (const [index, item] of items.slice(0, count).entries()) {
            const rank = index + 1;
            const title = typeof item.title === "string" ? item.title.trim() : "";
            const artists = item.subtitleLinks?.map(link => link.title?.trim()).filter(Boolean).join(", ");
            if (Number(item.rankingText) !== rank || !title || !artists) return null;
            rows.push(`${rank}. ${title} — ${artists}`);
        }

        // The public chart lists ranks but does not give a publication timestamp.
        const [locale, checkedLabel] = CHART_CHECKED[language] || CHART_CHECKED.hinglish;
        const checkedAt = new Date().toLocaleString(locale, {
            dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata",
        });
        return `**Apple Music India · Top Songs**\n${checkedLabel} ${checkedAt} IST\n\n${rows.join("\n")}\n\n<${APPLE_INDIA_CHART}>`;
    } catch {
        // If the page is unavailable or Apple changes its data layout, try browser search.
        return null;
    }
}

function formatLiveSearchReply(answer, { searchTools, finishReason, language, query }) {
    const [sourcesLabel, unverified] = REPLY_LABELS[language] || REPLY_LABELS.hinglish;
    if (!answer || finishReason !== "stop" || !Array.isArray(searchTools)) return unverified;

    const citedIndexes = new Set(Array.from(answer.matchAll(BROWSER_CITATION), match => Number(match[1])));
    const chartSources = getChartSources(query);
    const tools = searchTools.filter(tool => /^browser[._]/.test(tool?.type));
    const eligible = chartSources.length ? tools.filter(tool => /^browser\.(?:open|find)$/.test(tool.type)) : tools;
    const cited = eligible.filter(tool => citedIndexes.has(tool.index));
    if (citedIndexes.size && !cited.length) return unverified;

    const opened = eligible.filter(tool => tool.type === "browser.open");
    const evidence = cited.length ? cited : opened.length ? opened : eligible;
    const links = new Set();
    for (const tool of evidence) {
        for (const result of (tool.browser_results || tool.search_results?.results || [])) {
            const url = getSourceUrl(result);
            if (url && (!chartSources.length || chartSources.some(pattern => pattern.test(url)))) links.add(url);
        }
    }
    if (!links.size) return unverified;

    const text = answer.replace(BROWSER_CITATION, "").trim();
    if (!text) return unverified;
    return `${text}\n\n**${sourcesLabel}**\n${[...links].slice(0, 4).map(url => `<${url}>`).join("\n")}`;
}

module.exports = { getLiveSearchHistory, getIndiaMusicChartLimit, fetchIndiaMusicChart, formatLiveSearchReply };
