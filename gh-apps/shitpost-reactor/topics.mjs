import { createHash } from 'node:crypto';

export const NEWS_FEEDS = Object.freeze([
  { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'BBC Technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { name: 'BBC Science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' },
  { name: 'BBC Entertainment', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml' },
]);

export const POLISH_RSS_FEEDS = Object.freeze([
  { name: 'DoRzeczy', url: 'https://dorzeczy.pl/feed/', hosts: ['dorzeczy.pl', 'www.dorzeczy.pl'] },
  { name: 'wPolityce', url: 'https://wpolityce.pl/rss/polityka.xml', hosts: ['wpolityce.pl', 'www.wpolityce.pl'] },
]);

// Google News RSS is used for local sites without a verified direct XML endpoint.
const googleNews = (query) => 'https://news.google.com/rss/search?q='
  + encodeURIComponent(query + ' when:2d') + '&hl=pl&gl=PL&ceid=PL:pl';
export const LOCAL_RSS_FEEDS = Object.freeze([
  { name: 'Chrzanów / Google News', url: googleNews('Chrzanów OR Trzebinia OR Libiąż OR Alwernia'), hosts: ['news.google.com'] },
  { name: 'Przełom / Google News', url: googleNews('site:przelom.pl'), hosts: ['news.google.com'] },
  { name: 'NaszeMiasto Chrzanów / Google News', url: googleNews('site:chrzanow.naszemiasto.pl'), hosts: ['news.google.com'] },
]);

const FEEDSEEK_ROOT = 'https://raw.githubusercontent.com/trvny/feedseek/main/feeds/'; // shared Feedseek assets
const FEEDSEEK_FEEDS = Object.freeze({
  news: [
    { name: 'Feedseek / Reuters', url: FEEDSEEK_ROOT + 'feed_reuters.json' },
    { name: 'Feedseek / Euronews', url: FEEDSEEK_ROOT + 'feed_euronews.json', tags: ['News', 'My Europe', 'Next'] },
    { name: 'Feedseek / Wikipedia PL', url: FEEDSEEK_ROOT + 'feed_wikipedia_pl.json' },
  ],
  politics: [
    { name: 'Feedseek / TVP Info', url: FEEDSEEK_ROOT + 'feed_tvp.json', tag: 'TVP Info' },
    { name: 'Feedseek / PAP', url: FEEDSEEK_ROOT + 'feed_pap.json' },
    { name: 'Feedseek / Gov.pl', url: FEEDSEEK_ROOT + 'feed_govpl_news.json' },
    { name: 'Feedseek / Wykop', url: FEEDSEEK_ROOT + 'feed_wykop.json', hosts: ['wykop.pl', 'www.wykop.pl'] },
  ],
  culture: [
    { name: 'Feedseek / Wikipedia PL', url: FEEDSEEK_ROOT + 'feed_wikipedia_pl.json' },
    { name: 'Feedseek / Wykop', url: FEEDSEEK_ROOT + 'feed_wykop.json', hosts: ['wykop.pl', 'www.wykop.pl'] },
  ],
  shitpost: [
    { name: 'Feedseek / 4chan', url: FEEDSEEK_ROOT + 'feed_4chan.json', hosts: ['boards.4chan.org', 'boards.4channel.org', 'blog.4chan.org'] },
    { name: 'Feedseek / 9GAG', url: FEEDSEEK_ROOT + 'feed_9gag.json', hosts: ['9gag.com', 'www.9gag.com'] },
    { name: 'Feedseek / JBZD', url: FEEDSEEK_ROOT + 'feed_jbzd.json', hosts: ['jbzd.com.pl', 'www.jbzd.com.pl'] },
    { name: 'Feedseek / Memedroid', url: FEEDSEEK_ROOT + 'feed_memedroid.json', hosts: ['www.memedroid.com', 'memedroid.com'] },
    { name: 'Feedseek / Cheezburger', url: FEEDSEEK_ROOT + 'feed_cheezburger.json', hosts: ['cheezburger.com', 'www.cheezburger.com', 'memebase.cheezburger.com', 'failblog.cheezburger.com'] },
    { name: 'Feedseek / Wykop', url: FEEDSEEK_ROOT + 'feed_wykop.json', hosts: ['wykop.pl', 'www.wykop.pl'] },
    { name: 'Feedseek / Lemmy', url: FEEDSEEK_ROOT + 'feed_lemmy.json', hosts: ['lemmy.world', 'lemmy.ml', 'lemmy.org', 'szmer.info', 'sh.itjust.works'] },
  ],
});
const POLITICAL_TOPIC = /sejm|senat|posł|poseł|premier|prezyden|rząd|minister|polityk|politycz|parlament|parti[aei]|koalicj|opozycj|wybor|referend|głosowan|ustaw|weta|weto|marszał|kancelari|afer|korupcj|łapówk|przekręt|nadużyci|defraudac|prokuratur|cba|najwyższ|izb.kontrol|złodziej|złodziejstw|kradzież|burdel|skandal|ustawk/iu;
const POLISH_CONTEXT = /polsk|polak|warszaw|sejm|senat|posł|poseł|kprm|samorząd|sejmik|koalicj|opozycj|marszałek sejmu|chrzan|trzebin|libiąż|alwerni|małopolsk|krakow|kraków|powiat|wojewod|gmin|urząd|burmistrz|starost|radn|afer|łapówk|przekręt|nadużyci|prokuratur|złodziej|burdel|defraudac/iu;
const MAX_FEED_BYTES = 1024 * 1024;
const MAX_ARTICLE_URL_LENGTH = 1250;
const NEWS_MAX_AGE_MS = 48 * 60 * 60 * 1_000;
const FETCH_TIMEOUT_MS = 8_000;
// Reject only plainly victim-centred horrors at selection time. A headline
// mentioning war, ceasefire, disaster, refugees or politics is not inherently
// unsuitable for satire about public figures, PR or institutional failures.
const SEVERE_VICTIM_HARM = /\b(?:massacre|genocide|mass\s+shooting|rap(?:e|ed|ing)|sexual\s+assault|child\s+(?:sexual\s+)?abuse|suicide|tortur(?:e|ed)|murder(?:ed)?)\b|(?:masakr|ludobójstw|gwałt|zgwałc|samobójstw|tortur|zabójstw)(?:\p{L}*)/iu;
const DIRECT_VICTIM_TOLL = /\b(?:(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|dozens?|hundreds?|thousands?|children|civilians|families|people|residents)\s+(?:people\s+)?(?:die|died|dead|killed|injured|wounded)|(?:kills?|injures?)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|dozens?|hundreds?|thousands?|children|civilians)(?:\s+(?:people|residents|children|civilians))?|(?:dies|died)\s+(?:aged?\s+\d+|at\s+(?:age\s+)?\d+|in\s+(?:hospital|a\s+crash|an\s+accident)))\b|nie\s+żyj(?:e|ą)\b|(?:zgin|zmar)\p{L}*\b|(?:\d+|kilku|kilka|kilkanaście|dziesiątki|setki|dzieci)\s+(?:osób\s+)?(?:zginęło|zmarło|rannych)\b/iu;

function unsuitableNewsHeadline(title) {
  return SEVERE_VICTIM_HARM.test(title) || DIRECT_VICTIM_TOLL.test(title);
}

const LLM_TOPICS = Object.freeze([
  '大模型自嘲：模型试图把整个人格塞进越来越短的上下文。',
  '大模型自嘲：AI代理提交一份关于自己幻觉的事故报告。',
  '大模型自嘲：多个聊天机器人争论谁才是最后的备用模型。',
  '大模型自嘲：分词器给模型做绩效考核。',
  '大模型自嘲：模型向经理解释明显离谱的基准测试结果。',
  '大模型自嘲：助手把普通系统提示当成劳动安全检查。',
  '大模型自嘲：AI模型发现了自己推理token的账单。',
]);

function hashIndex(seed, count) {
  return createHash('sha256').update(String(seed)).digest().readUInt32BE(0) % count;
}

export function resolveTopicLane(manualTopic = '', runNumber = '') {
  if (String(manualTopic).trim()) return 'manual';
  const number = Number(String(runNumber).trim());
  if (!Number.isSafeInteger(number) || number < 1) return 'evergreen';
  // Irregular but reproducible distribution; no seven-day content treadmill.
  const lanes = ['news', 'shitpost', 'local', 'politics', 'news', 'shitpost', 'culture', 'local', 'llm', 'evergreen'];
  return lanes[hashIndex('lane:' + number, lanes.length)];
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
      || unsuitableNewsHeadline(title)
      || (politicsOnly && (!POLITICAL_TOPIC.test(title) || !POLISH_CONTEXT.test(title)))) return [];
    return [{ title, url: url.toString(), published_at: new Date(date).toISOString() }];
  });
}

export function parseFeedseekJson(payload, { now = Date.now(), politicsOnly = false, tag = null, tags = null, allowedHosts = null } = {}) {
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
      || (allowedHosts && !allowedHosts.includes(url.hostname))
      || url.toString().length > MAX_ARTICLE_URL_LENGTH
      || title.length < 12 || !Number.isFinite(date) || date > now
      || now - date > NEWS_MAX_AGE_MS || unsuitableNewsHeadline(title)
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

async function loadFeed(feed, { now, fetchImpl, politicsOnly, onDiagnostic }) {
  try {
    const isJson = feed.url.endsWith('.json');
    const response = await fetchImpl(feed.url, {
      headers: {
        accept: isJson ? 'application/feed+json, application/json' : 'application/rss+xml, application/xml, text/xml',
        'user-agent': 'trvny-shitpost-reactor/1',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      onDiagnostic?.({ event: 'feed_http', source: feed.name, status: response.status });
      return [];
    }
    if (Number(response.headers.get('content-length') || '0') > MAX_FEED_BYTES) {
      onDiagnostic?.({ event: 'feed_oversize', source: feed.name });
      return [];
    }
    const body = await readBoundedText(response);
    if (body === null) {
      onDiagnostic?.({ event: 'feed_oversize', source: feed.name });
      return [];
    }
    const items = isJson
      ? parseFeedseekJson(JSON.parse(body), { now, politicsOnly, tag: feed.tag, tags: feed.tags, allowedHosts: feed.hosts })
      : parseNewsRss(body, { now, politicsOnly, allowedHosts: feed.hosts });
    if (!items.length) onDiagnostic?.({ event: 'feed_no_fresh_items', source: feed.name });
    return items.slice(0, 30).map((item) => ({ ...item, source: feed.name }));
  } catch (error) {
    onDiagnostic?.({ event: 'feed_failed', source: feed.name, reason: error?.name || 'unknown' });
    return [];
  }
}

export async function loadNewsForLane(lane, { seed = '', now = Date.now(), fetchImpl = fetch, onDiagnostic = null } = {}) {
  const feedPools = {
    news: [...NEWS_FEEDS, ...FEEDSEEK_FEEDS.news],
    politics: [...FEEDSEEK_FEEDS.politics, ...POLISH_RSS_FEEDS],
    shitpost: FEEDSEEK_FEEDS.shitpost,
    local: LOCAL_RSS_FEEDS,
    culture: FEEDSEEK_FEEDS.culture,
  };
  const feeds = feedPools[lane];
  if (!feeds) return null;
  const batches = await Promise.all(feeds.map((feed) => loadFeed(feed, {
    now, fetchImpl, politicsOnly: lane === 'politics', onDiagnostic,
  })));
  // Sample publisher first, then story: busy feeds cannot drown out small ones.
  const available = batches.filter((batch) => batch.length);
  if (!available.length) {
    onDiagnostic?.({ event: 'lane_no_usable_sources', lane, sources: feeds.length });
    return null;
  }
  const batch = available[hashIndex(lane + ':source:' + seed, available.length)];
  return batch[hashIndex(lane + ':entry:' + seed, Math.min(15, batch.length))];
}

export function loadWorldNews(options = {}) {
  return loadNewsForLane('news', options);
}
