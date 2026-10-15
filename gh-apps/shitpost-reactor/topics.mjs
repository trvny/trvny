import { createHash } from 'node:crypto';

export const NEWS_FEEDS = Object.freeze([
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
]);

const MAX_FEED_BYTES = 256 * 1024;
const NEWS_MAX_AGE_MS = 48 * 60 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 8_000;
const SENSITIVE_NEWS = /\b(kill(?:ed|ing|s)?|dead|death|die|dies|died|fatal(?:ity|ities)?|victim(?:s)?|massacre|murder(?:ed)?|suicide|rape|abuse|hostage(?:s)?|bomb(?:ing|ed)?|airstrike(?:s)?|earthquake(?:s)?|flood(?:s|ing)?|famine|genocide|casualt(?:y|ies)|shooting(?:s)?|terror(?:ist|ism)?|war crimes|injur(?:y|ies|ed)|wound(?:ed|s)?|crash(?:es|ed)?|wildfire(?:s)?|blaze(?:s)?|evacuat(?:ion|ed)|drown(?:ed|ing)?|collapsed)\b/i;

const LLM_TOPICS = Object.freeze([
  'LLM self-roast: a model tries to fit its entire personality into a shrinking context window.',
  'LLM self-roast: an AI agent files an incident report about its own hallucination.',
  'LLM self-roast: multiple chatbots debate which one is the fallback model.',
  'LLM self-roast: a model gets a performance review from its tokenizer.',
  'LLM self-roast: a model explains an obviously broken benchmark result to its manager.',
  'LLM self-roast: an assistant treats a routine system prompt as a workplace safety inspection.',
  'LLM self-roast: an AI model discovers the invoice for its reasoning tokens.',
]);

function hashIndex(seed, count) {
  return createHash('sha256').update(String(seed)).digest().readUInt32BE(0) % count;
}

export function resolveTopicLane(manualTopic = '', runNumber = '') {
  if (String(manualTopic).trim()) return 'manual';
  const number = Number(String(runNumber).trim());
  if (!Number.isSafeInteger(number) || number < 1) return 'evergreen';
  if (number % 7 === 1) return 'news';
  if (number % 7 === 4) return 'llm';
  return 'evergreen';
}

export function chooseLLMTopic(seed = '') {
  return LLM_TOPICS[hashIndex('llm:' + seed, LLM_TOPICS.length)];
}

function decodeXml(value) {
  return value.replace(/&#(x[0-9a-f]+|\d+);|&(amp|lt|gt|quot|apos|nbsp|ndash|mdash);/gi, (entity, numeric, named) => {
    if (numeric) {
      const code = numeric[0].toLowerCase() === 'x'
        ? Number.parseInt(numeric.slice(1), 16)
        : Number.parseInt(numeric, 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : '';
    }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' }[named.toLowerCase()];
  });
}

function rssValue(item, tag) {
  const pattern = '<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>';
  const match = item.match(new RegExp(pattern, 'i'));
  if (!match) return '';
  return decodeXml(match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1').trim())
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseNewsRss(xml, { now = Date.now() } = {}) {
  if (typeof xml !== 'string' || Buffer.byteLength(xml, 'utf8') > MAX_FEED_BYTES) return [];
  const entries = xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  return entries.slice(0, 40).flatMap((entry) => {
    const title = rssValue(entry, 'title').slice(0, 240);
    const date = Date.parse(rssValue(entry, 'pubDate'));
    const rawUrl = rssValue(entry, 'link');
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return [];
    }
    if (!['www.bbc.com', 'www.bbc.co.uk', 'bbc.com', 'bbc.co.uk'].includes(url.hostname)
      || url.protocol !== 'https:' || !title || title.length < 12
      || !Number.isFinite(date) || date > now || now - date > NEWS_MAX_AGE_MS
      || SENSITIVE_NEWS.test(title)) return [];
    return [{ title, url: url.toString(), published_at: new Date(date).toISOString() }];
  });
}

export async function loadWorldNews({ seed = '', now = Date.now(), fetchImpl = fetch } = {}) {
  const entries = [];
  for (const feed of NEWS_FEEDS) {
    try {
      const response = await fetchImpl(feed.url, {
        headers: { accept: 'application/rss+xml, application/xml, text/xml', 'user-agent': 'trvny-shitpost-reactor/1' },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok || Number(response.headers.get('content-length') || '0') > MAX_FEED_BYTES) continue;
      const feedEntries = parseNewsRss(await response.text(), { now });
      entries.push(...feedEntries.map((entry) => ({ ...entry, source: feed.name })));
    } catch {
      // Optional live source. Never invent a headline when it fails.
    }
  }
  const unique = [...new Map(entries.map((entry) => [entry.url, entry])).values()];
  if (!unique.length) return null;
  return unique[hashIndex('news:' + seed, unique.length)];
}
