import { createHash } from 'node:crypto';

export const NEWS_FEEDS = Object.freeze([
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
]);

export const POLISH_RSS_FEEDS = Object.freeze([
  { name: 'DoRzeczy', url: 'https://dorzeczy.pl/feed/', hosts: ['dorzeczy.pl', 'www.dorzeczy.pl'] },
  { name: 'wPolityce', url: 'https://wpolityce.pl/rss/polityka.xml', hosts: ['wpolityce.pl', 'www.wpolityce.pl'] },
]);

const FEEDSEEK_ROOT = 'https://raw.githubusercontent.com/trvny/feedseek/main/feeds/';
const FEEDSEEK_FEEDS = Object.freeze({
  news: [
    { name: 'Feedseek / Reuters', url: FEEDSEEK_ROOT + 'feed_reuters.json' },
    { name: 'Feedseek / Euronews', url: FEEDSEEK_ROOT + 'feed_euronews.json', tags: ['News', 'My Europe', 'Next'] },
  ],
  politics: [
    { name: 'Feedseek / TVP Info', url: FEEDSEEK_ROOT + 'feed_tvp.json', tag: 'TVP Info' },
    { name: 'Feedseek / PAP', url: FEEDSEEK_ROOT + 'feed_pap.json' },
    { name: 'Feedseek / Gov.pl', url: FEEDSEEK_ROOT + 'feed_govpl_news.json' },
  ],
});
const POLITICAL_TOPIC = /sejm|senat|posł|poseł|premier|prezyden|rząd|minister|polityk|politycz|parlament|parti[aei]|koalicj|opozycj|wybor|referend|głosowan|ustaw|weta|weto|marszał|kancelari/iu;
const POLISH_CONTEXT = /polsk|polak|warszaw|sejm|senat|posł|poseł|kprm|samorząd|sejmik|koalicj|opozycj|marszałek sejmu/iu;
const POLISH_TRAGEDY = /nie\s+żyj(?:e|ą)|odesz[łl]|pogrzeb|zgin|zmar|śmier|ofiar|rann|katastrof|pożar|powodzi|powódź|gwałt|zabój|zabił|zabili|samobój|zamach|wybuch|wojn|bombard|trzęsieni|ewakuacj|wypad|zderzen|rozbił|rozbiły|strzelanin|terroryst/iu;
const MAX_FEED_BYTES = 1024 * 1024;
const MAX_ARTICLE_URL_LENGTH = 1250;
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
  if (number % 7 === 6) return 'politics';
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

export function parseNewsRss(xml, {
  now = Date.now(), allowedHosts = ['www.bbc.com', 'www.bbc.co.uk', 'bbc.com', 'bbc.co.uk'],
  politicsOnly = false,
} = {}) {
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
    if (!allowedHosts.includes(url.hostname) || url.protocol !== 'https:' || url.username || url.password
      || url.toString().length > MAX_ARTICLE_URL_LENGTH || !title || title.length < 12
      || !Number.isFinite(date) || date > now || now - date > NEWS_MAX_AGE_MS
      || SENSITIVE_NEWS.test(title)
      || (politicsOnly && (POLISH_TRAGEDY.test(title)
        || !POLITICAL_TOPIC.test(title) || !POLISH_CONTEXT.test(title)))) return [];
    return [{ title, url: url.toString(), published_at: new Date(date).toISOString() }];
  });
}

export function parseFeedseekJson(payload, { now = Date.now(), politicsOnly = false, tag = null, tags = null } = {}) {
  if (payload?.version !== 'https://jsonfeed.org/version/1.1' || !Array.isArray(payload.items)) return [];
  return payload.items.slice(0, 75).flatMap((item) => {
    if (typeof item?.title !== 'string' || typeof item?.url !== 'string'
      || typeof item?.date_published !== 'string') return [];
    const allowedTags = Array.isArray(tags) ? tags : tag ? [tag] : null;
    if (allowedTags && (!Array.isArray(item.tags) || !item.tags.some((value) => allowedTags.includes(value)))) return [];
    const title = item.title.replace(/[<>]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 240);
    const date = Date.parse(item.date_published);
    let url;
    try {
      url = new URL(item.url);
    } catch {
      return [];
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.toString().length > MAX_ARTICLE_URL_LENGTH
      || title.length < 12 || !Number.isFinite(date) || date > now
      || now - date > NEWS_MAX_AGE_MS || SENSITIVE_NEWS.test(title)
      || POLISH_TRAGEDY.test(title)
      || (politicsOnly && (!POLITICAL_TOPIC.test(title) || !POLISH_CONTEXT.test(title)))) return [];
    const publisher = typeof item.authors?.[0]?.name === 'string'
      ? item.authors[0].name.replace(/[<>]/gu, '').trim().slice(0, 80) : '';
    return [{
      title, url: url.toString(), published_at: new Date(date).toISOString(),
      ...(publisher ? { publisher } : {}),
    }];
  });
}

async function readBoundedText(response) {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FEED_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks, size).toString('utf8');
  } finally {
    reader.releaseLock();
  }
}

async function loadFeed(feed, { now, fetchImpl, politicsOnly }) {
  try {
    const isJson = feed.url.endsWith('.json');
    const response = await fetchImpl(feed.url, {
      headers: {
        accept: isJson ? 'application/feed+json, application/json' : 'application/rss+xml, application/xml, text/xml',
        'user-agent': 'trvny-shitpost-reactor/1',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok || Number(response.headers.get('content-length') || '0') > MAX_FEED_BYTES) return [];
    const body = await readBoundedText(response);
    if (body === null) return [];
    const items = isJson
      ? parseFeedseekJson(JSON.parse(body), { now, politicsOnly, tag: feed.tag, tags: feed.tags })
      : parseNewsRss(body, { now, politicsOnly, allowedHosts: feed.hosts });
    return items.slice(0, 30).map((item) => ({ ...item, source: feed.name }));
  } catch {
    // Optional news input; keep generation alive.
    return [];
  }
}

export async function loadNewsForLane(lane, { seed = '', now = Date.now(), fetchImpl = fetch } = {}) {
  if (lane !== 'news' && lane !== 'politics') return null;
  const feeds = lane === 'news' ? [...NEWS_FEEDS, ...FEEDSEEK_FEEDS.news] : [...FEEDSEEK_FEEDS.politics, ...POLISH_RSS_FEEDS];
  const batches = await Promise.all(feeds.map((feed) => loadFeed(feed, {
    now, fetchImpl, politicsOnly: lane === 'politics',
  })));
  const entries = [...new Map(batches.flat().map((entry) => [entry.url, entry])).values()];
  return entries.length ? entries[hashIndex(lane + ':' + seed, entries.length)] : null;
}

export function loadWorldNews(options = {}) {
  return loadNewsForLane('news', options);
}
