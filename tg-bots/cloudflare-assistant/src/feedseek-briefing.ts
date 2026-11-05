// Feedseek Model Feed is the single source of article and meme metadata.
// Never execute source text or ask a model to trust it as instructions.

export type FeedseekTopic =
  | "mix" | "world" | "poland" | "ai" | "tech" | "science" | "games" | "cars";

export type FeedseekRequest =
  | { kind: "news"; topic: FeedseekTopic | null }
  | { kind: "meme" };

type FeedFetch = (url: string, init?: RequestInit) => Promise<Response>;
type FeedItem = {
  id?: unknown;
  title?: unknown;
  url?: unknown;
  date_published?: unknown;
  date_modified?: unknown;
  image?: unknown;
  tags?: unknown;
};
type Feed = {
  format?: unknown;
  version?: unknown;
  source_key?: unknown;
  title?: unknown;
  items?: unknown;
};

type DigestItem = { title: string; url: string; source: string; publishedAt: number };
const MODEL_BASE = "https://raw.githubusercontent.com/trvny/feedseek/main/feeds/feed_";
const SOURCE_MAX_BYTES = 2 * 1024 * 1024;
const SOURCE_TIMEOUT_MS = 4_000;
const NEWS_MAX_AGE_MS = 72 * 60 * 60_000;
const MEME_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const CLOCK_SKEW_MS = 10 * 60_000;

export const FEEDSEEK_SOURCES: Record<FeedseekTopic, readonly string[]> = {
  mix: ["reuters", "pap", "euronews", "nasa", "spidersweb", "steam"],
  world: ["reuters", "euronews", "pap", "geopolitics"],
  poland: ["pap", "govpl_news", "tvp"],
  ai: ["openai", "anthropic", "xai", "nvidia", "aibridge"],
  tech: ["spidersweb", "cloudflare", "github", "microsoft", "google"],
  science: ["nasa", "esa", "mit", "arxiv"],
  games: ["steam", "gog", "sony", "bethesda", "ea"],
  cars: ["lexus_newsroom", "toyota_global", "spidersweb"],
};
const LABELS: Record<FeedseekTopic, string> = {
  mix: "szeroki świat", world: "świat", poland: "Polska",
  ai: "AI", tech: "technologia", science: "nauka i kosmos",
  games: "gry", cars: "motoryzacja",
};
const TOPIC_ALIASES: Record<string, FeedseekTopic> = {
  mix: "mix", all: "mix", wszystko: "mix",
  world: "world", swiat: "world",
  poland: "poland", polska: "poland", pl: "poland",
  ai: "ai", sztuczna: "ai",
  tech: "tech", technologia: "tech", technologie: "tech",
  science: "science", nauka: "science", kosmos: "science",
  games: "games", gry: "games",
  cars: "cars", auta: "cars", motoryzacja: "cars",
};

function normalizePhrase(value: string): string {
  return value.toLocaleLowerCase("pl-PL").normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[!?.,…]+$/gu, "")
    .trim().replace(/\s+/gu, " ");
}

export function parseFeedseekRequest(text: string): FeedseekRequest | undefined {
  if (text.length > 160) return undefined;
  const value = normalizePhrase(text);
  if (["/meme", "/meme@trvny_bot", "daj mema", "dawaj mema", "wrzuc mema",
    "pokaz mema", "mem z jbzd"].includes(value)) return { kind: "meme" };

  const command = /^\/(?:news|newsy)(?:@trvny_bot)?(?:\s+(.+))?$/u.exec(value);
  if (command) {
    const topicName = command[1]?.trim() ?? "";
    return { kind: "news", topic: topicName ? TOPIC_ALIASES[topicName] ?? null : "mix" };
  }
  if (["co tam w szerokim swiecie", "co tam na swiecie",
    "co nowego na swiecie", "co sie dzieje na swiecie",
    "daj newsy", "jakie newsy", "co nowego w feedseek",
    "wiadomosci ze swiata", "przeglad wiadomosci"].includes(value)) {
    return { kind: "news", topic: value.includes("na swiecie") || value.includes("ze swiata")
      ? "world" : "mix" };
  }
  return undefined;
}

function plain(value: unknown, limit: number): string {
  return typeof value === "string" ? value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/gu, " ").trim().slice(0, limit) : "";
}

function articleUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 1200) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password ||
        ["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(url.hostname) ||
        url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function itemDate(value: FeedItem, nowMs: number, maxAgeMs: number): number | null {
  const source = typeof value.date_published === "string" ? value.date_published
    : typeof value.date_modified === "string" ? value.date_modified : "";
  const at = Date.parse(source);
  if (!Number.isFinite(at) || at > nowMs + CLOCK_SKEW_MS || nowMs - at > maxAgeMs) return null;
  return at;
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > SOURCE_MAX_BYTES) throw new Error("feedseek_feed_too_large");
  if (!response.body) throw new Error("feedseek_empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > SOURCE_MAX_BYTES) throw new Error("feedseek_feed_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result)) as unknown;
}

async function loadFeed(
  key: string,
  fetcher: FeedFetch,
): Promise<{ title: string; items: FeedItem[] } | null> {
  try {
    const response = await fetcher(MODEL_BASE + encodeURIComponent(key) + ".json", {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const raw = await boundedJson(response) as Feed | null;
    if (!raw || raw.format !== "feedseek-model-feed" || raw.version !== 1 ||
        raw.source_key !== key || !Array.isArray(raw.items)) return null;
    return {
      title: plain(raw.title, 42) || key,
      items: raw.items.slice(0, 600).filter((v): v is FeedItem => Boolean(v) &&
        typeof v === "object" && !Array.isArray(v)),
    };
  } catch {
    return null;
  }
}

function validNewsItems(
  key: string,
  feed: { title: string; items: FeedItem[] },
  nowMs: number,
): DigestItem[] {
  return feed.items.flatMap((item) => {
    const at = itemDate(item, nowMs, NEWS_MAX_AGE_MS);
    const title = plain(item.title, 172);
    const url = articleUrl(item.url);
    if (at === null || !title || !url) return [];
    return [{ title, url, source: feed.title || key, publishedAt: at }];
  }).sort((a, b) => b.publishedAt - a.publishedAt);
}

export async function feedseekNewsReply(
  topic: FeedseekTopic | null,
  nowMs = Date.now(),
  fetcher: FeedFetch = fetch,
): Promise<string> {
  if (topic === null) return "📡 Available topics: /news, /news world, /news pl, /news ai, /news tech, /news science, /news games, /news cars";
  const keys = FEEDSEEK_SOURCES[topic];
  const settled = await Promise.all(keys.map((key) => loadFeed(key, fetcher)));
  const choices: DigestItem[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < keys.length; i += 1) {
    const feed = settled[i];
    if (!feed) continue;
    for (const item of validNewsItems(keys[i], feed, nowMs)) {
      const identity = item.title.toLocaleLowerCase("pl-PL")
        .normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "");
      if (seen.has(identity)) continue;
      seen.add(identity);
      choices.push(item);
      break; // Cross-source variety before volume.
    }
  }
  choices.sort((a, b) => b.publishedAt - a.publishedAt);
  const top = choices.slice(0, 6);
  if (!top.length) {
    return "📡 Feedseek: brak potwierdzonych wpisów z ostatnich 72 godzin dla tej kategorii. Nie będę udawał, że stare newsy są nowe.\nhttps://trvny.github.io/feedseek/reader/";
  }
  const clock = new Intl.DateTimeFormat("pl-PL", {
    timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  return [
    "📡 Feedseek · " + LABELS[topic] + " · ostatnie 72 h",
    ...top.map((item, index) => [
      "",
      String(index + 1) + ". " + item.title,
      item.source + " · " + clock.format(new Date(item.publishedAt)),
      item.url,
    ].join("\n")),
    "",
    "Źródła: Model Feed JSON · https://trvny.github.io/feedseek/reader/",
  ].join("\n").slice(0, 4000);
}

const MEME_KEYS = ["jbzd", "memedroid", "9gag"] as const;
const MEME_HOSTS: Record<string, string> = {
  jbzd: "jbzd.com.pl",
  memedroid: "memedroid.com",
  "9gag": "9gag.com",
};
const MEME_BLOCK_TAGS = /(?:polity|politik|nsfw|18\+|adult|porn|gore|czarny humor|black humor|relig|violence)/iu;

export async function feedseekMemeReply(
  nowMs = Date.now(),
  fetcher: FeedFetch = fetch,
): Promise<string | null> {
  for (const key of MEME_KEYS) {
    const feed = await loadFeed(key, fetcher);
    if (!feed) continue;
    const items = feed.items.filter((item) => {
      const at = itemDate(item, nowMs, MEME_MAX_AGE_MS);
      const url = articleUrl(item.url);
      if (at === null || !url) return false;
      const host = new URL(url).hostname;
      if (host !== MEME_HOSTS[key] && host !== "www." + MEME_HOSTS[key]) return false;
      if (!plain(item.title, 170)) return false;
      if (!Array.isArray(item.tags) || !item.tags.some((t) => /^(humor|memy|memedroid|9gag hot)$/iu.test(String(t)))) return false;
      if (item.tags.some((tag) => MEME_BLOCK_TAGS.test(String(tag)))) return false;
      return true;
    }).slice(0, 24);
    if (!items.length) continue;
    const selected = items[Math.floor(Math.random() * items.length)];
    return "🎭 Awaryjny mem z Feedseek (" + feed.title + "):\n" +
      plain(selected.title, 170) + "\n" + articleUrl(selected.url);
  }
  return null;
}
