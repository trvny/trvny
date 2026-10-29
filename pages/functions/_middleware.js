import { pageSeoHead } from "./_shared/page-seo.js";
import { brandResponse } from "./_shared/brand-page.js";

const CHANNELS = [
  { id: "399697", no: "101", slug: "tvp1", tag: "TVP1", name: "TVP 1 HD" },
  { id: "399698", no: "102", slug: "tvp2", tag: "TVP2", name: "TVP 2 HD" },
  { id: "399699", no: "103", slug: "tvpinfo", tag: "INFO", name: "TVP Info" },
  { id: "399702", no: "104", slug: "tvpsport", tag: "SPORT", name: "TVP Sport" },
  { id: "399721", no: "105", slug: "tvpdokument", tag: "DOK", name: "TVP Dokument" },
  { id: "399722", no: "106", slug: "tvpnauka", tag: "NAUKA", name: "TVP Nauka" },
  { id: "399724", no: "107", slug: "tvprozrywka", tag: "ROZR", name: "TVP Rozrywka" },
  { id: "399703", no: "108", slug: "tvphistoria", tag: "HIST", name: "TVP Historia" },
  { id: "2999109", no: "109", slug: "tvpmuzyka", tag: "MUZ", name: "TVP Muzyka i Koncerty" },
];

const TV_WORKER = "https://tvpi.travny.workers.dev";
const WEATHER_STATE = "https://weather.travny.workers.dev/state.json";

// Several hosts reach this same site/ output, and they are treated differently.
//
// Stable hub: travny.pages.dev. Distinct brand homepage: trfny.com.
// Brand discovery and old deep-link redirects: _shared/brand-page.js.
// Deployment preview aliases stay excluded from search.
//
// Preview deployment aliases still serve the Pages output, but responses
// are noindex so only the stable production hostname is indexed.
// Old custom-domain deep links keep their path and query on the stable hub.
//
// tvpi.pages.dev is a separate legacy project in trvny/tvpi.
// Its redirect target must match this primary host.
// Preview aliases are matched separately, so the primary Pages host
// is indexable while <hash>.travny.pages.dev remains noindex.
const REDIRECT_HOSTS = new Set(["tvpi.pages.dev"]);
const PREVIEW_SUFFIX = ".travny.pages.dev";
const CANONICAL_HOST = "travny.pages.dev";
const NAV_HEAD = '<link rel="stylesheet" href="/assets/nav.css"><link rel="alternate" type="application/atom+xml" href="/teksty/feed.xml" title="TRAVNY Teksty + Shitposts">';
const NAV_BODY = `
<button id="trvny-nav-toggle" type="button" aria-controls="trvny-nav-drawer" aria-expanded="false" aria-label="Otwórz menu">☰</button>
<div id="trvny-nav-backdrop" hidden></div>
<aside id="trvny-nav-drawer" data-open="false" aria-hidden="true" aria-label="Nawigacja TRAVNY" inert>
  <div id="trvny-nav-head"><span id="trvny-nav-brand">TRAVNY</span><button id="trvny-nav-close" type="button" aria-label="Zamknij menu">×</button></div>
  <nav>
    <div class="trvny-nav-group"><span class="trvny-nav-label">START</span><a class="trvny-nav-link" href="/">Strona główna<small>hub TRAVNY</small></a><a class="trvny-nav-link" href="/tv/">TVP<small>kanały i odtwarzacz</small></a></div>
    <div class="trvny-nav-group"><span class="trvny-nav-label">USŁUGI</span><a class="trvny-nav-link" href="https://weather.travny.workers.dev/">Pogoda</a><a class="trvny-nav-link" href="https://trvny.github.io/feedseek/">Feedy</a></div>
    <div class="trvny-nav-group"><span class="trvny-nav-label">LAB</span><a class="trvny-nav-link" href="https://streambench.travny.workers.dev/">Streambench</a><a class="trvny-nav-link" href="https://codebench.travny.workers.dev/">Codebench</a><a class="trvny-nav-link" href="https://docbench.travny.workers.dev/">Docbench</a><a class="trvny-nav-link" href="/papagenerator/">Papagenerator</a></div>
    <div class="trvny-nav-group"><span class="trvny-nav-label">TEKSTY</span><a class="trvny-nav-link" href="/teksty/">Wszystkie teksty</a><a class="trvny-nav-link" href="/teksty/githubowa-kraina/">GitHubowa Kraina<small>atlas projektów</small></a><a class="trvny-nav-link" href="/teksty/token-worldcup/">Tokenowy Mundial AI</a></div>
  </nav>
</aside>
<script src="/assets/nav.js" defer></script>
<script src="/assets/webmcp.js" defer></script>`;

function isPreviewHost(hostname) {
  return hostname.endsWith(PREVIEW_SUFFIX);
}

const CONDITIONS = {
  clear: ["Słonecznie", "☀"],
  clouds: ["Pochmurno", "☁"],
  fewclouds: ["Mało chmur", "⛅"],
  rain: ["Deszcz", "🌧"],
  drizzle: ["Mżawka", "🌦"],
  snow: ["Śnieg", "❄"],
  thunder: ["Burza", "⚡"],
  fog: ["Mgła", "🌫"],
  mist: ["Mgiełka", "🌫"],
  unknown: ["Brak danych", "•"],
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function roundMedian(group) {
  const value = group?.median;
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;
}

function aqiClass(value) {
  const aqi = Number(value);
  if (!Number.isFinite(aqi)) return ["mid", "?"];
  if (aqi <= 40) return ["good", String(Math.round(aqi))];
  if (aqi <= 80) return ["mid", String(Math.round(aqi))];
  return ["bad", String(Math.round(aqi))];
}

// Returns the body already read, because the abort signal has to stay armed
// until then: a server that answers with headers immediately and then drips
// the body would otherwise hold the page render open with no bound at all.
// The timeout covers the whole exchange, not just the wait for headers.
async function fetchWithTimeout(url, options = {}, timeoutMs = 4500, parse = "text") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) return { ok: false, body: null };
    return { ok: true, body: parse === "json" ? await response.json() : await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function getWeather() {
  try {
    const { ok, body } = await fetchWithTimeout(WEATHER_STATE, {
      cf: { cacheTtl: 300, cacheEverything: true },
      headers: { accept: "application/json" },
    }, 4500, "json");
    return ok ? body : null;
  } catch {
    return null;
  }
}

// The edge cannot know which channels are actually up, so it says so.
//
// This used to derive availability from membership in /playlist.m3u, on the
// stated assumption that "the playlist contains only channels for which the
// Worker found a usable URL". That assumption is false against the deployed
// Worker: buildStablePlaylist (worker/src/entry.ts:48) emits all nine channels
// unconditionally from a static array, and advertises exactly that in its
// X-Playlist-Type: stable-channel-endpoints header. A stream is resolved only
// when its own .m3u8 endpoint is opened. So every channel matched, every chip
// rendered "on", and the page reported 9/9 ON AIR whatever the real state was.
//
// Returning null renders the chips without a status class and the /tv rows as
// SPRAWDZ, which the browser checks then resolve for real. Slower to a truthful
// number, but it is a truthful number. Giving the edge a real answer means
// teaching the Worker to report per-channel availability; until then, it has
// nothing to say.
function getChannels() {
  return CHANNELS.map((channel) => ({ ...channel, status: null }));
}

function channelClass(status) {
  if (status === true) return "on";
  if (status === false) return "off";
  return "";
}

function renderHubChips(channels) {
  return channels
    .map(
      (channel) =>
        `<span class="chip ${channelClass(channel.status)}" id="c-${channel.slug}">` +
        `<span class="d">${channel.no}</span>${escapeHtml(channel.tag)}</span>`,
    )
    .join("");
}

function renderTvRows(channels) {
  return channels
    .map((channel) => {
      const statusClass = channel.status === true ? "on" : channel.status === false ? "off" : "chk";
      const statusText = channel.status === true ? "NADAJE" : channel.status === false ? "BRAK" : "SPRAWDŹ";
      const stream = `${TV_WORKER}/${channel.slug}.m3u8`;
      return (
        `<div class="row" role="button" tabindex="0" data-copy="${stream}" data-slug="${channel.slug}">` +
        `<span class="no">${channel.no}</span>` +
        `<span class="nm">${escapeHtml(channel.name)}</span>` +
        `<span class="lead"></span>` +
        `<span class="st ${statusClass}" id="st-${channel.slug}">${statusText}</span>` +
        `<span class="cp">⤓ COPY</span></div>`
      );
    })
    .join("");
}

function renderWeather(state) {
  if (!state) return null;

  const ensemble = state.ensemble || {};
  const temperature = roundMedian(ensemble.tempC);
  const feels = roundMedian(ensemble.feelsC);
  const wind = roundMedian(ensemble.windMs);
  const humidity = roundMedian(ensemble.humidity);
  const [conditionText, conditionIcon] = CONDITIONS[ensemble.condition] || CONDITIONS.unknown;
  const air = state.airQuality || {};
  const [airClass, airValue] = aqiClass(air.europeanAqi);

  const pollen =
    air.topPollen && Number(air.topPollen.grains) > 0
      ? ` · pyłki: <span class="g">${escapeHtml(air.topPollen.species)} ${escapeHtml(air.topPollen.grains)}</span>`
      : "";

  const warnings = Array.isArray(state.warnings)
    ? state.warnings.filter((warning) => warning?.event)
    : [];

  return {
    temperature: `${temperature ?? "—"}°`,
    condition: `${conditionIcon} ${escapeHtml(conditionText)}`,
    meta:
      `odczuwalna <b>${feels == null ? "—" : `${feels}°`}</b> · ` +
      `wiatr <b>${wind == null ? "—" : `${wind} m/s`}</b> · ` +
      `wilg. <b>${humidity == null ? "—" : `${humidity}%`}</b>` +
      `<br>AQI <span class="aqi ${airClass}">${airValue}</span>${pollen}`,
    warning:
      warnings.length > 0
        ? `⚠ ${escapeHtml(warnings[0].event)}${warnings.length > 1 ? ` · +${warnings.length - 1}` : ""}`
        : "",
  };
}

class SetAttribute {
  constructor(name, value) {
    this.name = name;
    this.value = value;
  }
  element(element) {
    element.setAttribute(this.name, this.value);
  }
}

class SetText {
  constructor(value, html = false) {
    this.value = value;
    this.html = html;
  }
  element(element) {
    element.setInnerContent(this.value, { html: this.html });
  }
}

class AppendHtml {
  constructor(value) {
    this.value = value;
  }
  element(element) {
    element.append(this.value, { html: true });
  }
}

function identifyPage(pathname) {
  if (pathname === "/" || pathname === "/index.html") return "home";
  if (pathname === "/tv" || pathname === "/tv/" || pathname === "/tv/index.html") return "tv";
  if (pathname === "/papagenerator" || pathname === "/papagenerator/" || pathname === "/papagenerator/index.html") return "papagenerator";
  if (pathname === "/teksty" || pathname === "/teksty/" || pathname === "/teksty/index.html") return "texts";
  if (pathname === "/teksty/token-worldcup" || pathname === "/teksty/token-worldcup/" || pathname === "/teksty/token-worldcup/token-worldcup" || pathname === "/teksty/token-worldcup/token-worldcup.html") return "token-worldcup";
  if (pathname === "/teksty/githubowa-kraina" || pathname === "/teksty/githubowa-kraina/" || pathname === "/teksty/githubowa-kraina/index.html") return "githubowa-kraina";
  if (pathname === "/teksty/grass-mud-horse" || pathname === "/teksty/grass-mud-horse/" || pathname === "/teksty/grass-mud-horse/index.html") return "grass-mud-horse";
  return null;
}

function withPreviewNoindex(response, hostname) {
  if (!isPreviewHost(hostname)) return response;
  const headers = new Headers(response.headers);
  headers.set("x-robots-tag", "noindex, follow");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function onRequest(context) {
  const brand = brandResponse(context.request);
  if (brand) return brand;
  const url = new URL(context.request.url);

  // Permanent, path- and query-preserving move. 301 (not 302) is what lets
  // Search Console transfer ranking signals to the new host; Google asks for
  // these redirects to stay up at least a year after the move.
  if (REDIRECT_HOSTS.has(url.hostname)) {
    url.hostname = CANONICAL_HOST;
    return Response.redirect(url.toString(), 301);
  }

  if (context.request.method !== "GET") {
    return withPreviewNoindex(await context.next(), url.hostname);
  }

  const page = identifyPage(url.pathname);
  const isEnglishPage = page === "grass-mud-horse" || page === "papagenerator"
    || url.pathname === "/lab" || url.pathname.startsWith("/lab/");
  const pageLanguage = isEnglishPage ? "en" : "pl";
  const needsChannels = page === "home" || page === "tv";
  const needsWeather = page === "home";
  const [assetResponse, channels, weatherState] = await Promise.all([
    context.next(),
    needsChannels ? getChannels() : Promise.resolve([]),
    needsWeather ? getWeather() : Promise.resolve(null),
  ]);

  const contentType = assetResponse.headers.get("content-type") || "";
  if (!assetResponse.ok || !contentType.includes("text/html")) {
    return withPreviewNoindex(assetResponse, url.hostname);
  }

  const online = channels.filter((channel) => channel.status === true).length;
  const known = channels.some((channel) => channel.status !== null);
  const countText = known ? `${online}/${channels.length}` : `—/${channels.length}`;

  let rewriter = new HTMLRewriter()
    .on("html", new SetAttribute("lang", pageLanguage))
    .on("head", new AppendHtml(NAV_HEAD))
    .on("head", new AppendHtml(pageSeoHead(url.pathname)))
    .on("body", new AppendHtml(NAV_BODY));

  if (page === "papagenerator") {
    rewriter = rewriter.on("head", new AppendHtml('<link rel="canonical" href="https://travny.pages.dev/papagenerator/">'));
  }

  if (page === "token-worldcup") {
    rewriter = rewriter.on(
      "head",
      new AppendHtml('<link rel="canonical" href="https://travny.pages.dev/teksty/token-worldcup/"><meta property="og:url" content="https://travny.pages.dev/teksty/token-worldcup/">'),
    );
  }

  if (page === "home") {
    rewriter = rewriter
      .on("#tvchips", new SetText(renderHubChips(channels), true))
      .on("#tvbig", new SetText(countText))
      .on("#tvcount", new SetText(`${countText} ON AIR`));

    const weather = renderWeather(weatherState);
    if (weather) {
      rewriter = rewriter
        .on("#wxtemp", new SetText(weather.temperature))
        .on("#wxcond", new SetText(weather.condition, true))
        .on("#wxmeta", new SetText(weather.meta, true));
      if (weather.warning) {
        rewriter = rewriter
          .on("#wxwarn", new SetText(weather.warning))
          .on("#wxwarn", new SetAttribute("class", "wxwarn show"));
      }
    }
  } else if (page === "tv") {
    rewriter = rewriter
      .on("#rows", new SetText(renderTvRows(channels), true))
      .on("#chCount", new SetText(`${countText} ON AIR`));
  }

  const transformed = rewriter.transform(assetResponse);
  const headers = new Headers(transformed.headers);
  headers.set("cache-control", "public, max-age=0, s-maxage=120, stale-while-revalidate=300");
  headers.set("content-language", pageLanguage);

  const markdownPath =
    page === "home" ? "/index.md" :
      page === "tv" ? "/tv/index.md" :
        page === "texts" ? "/teksty/index.md" :
          page === "githubowa-kraina" ? "/teksty/githubowa-kraina/index.md" : null;
  headers.set(
    "link",
    markdownPath
      ? `<${markdownPath}>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"`
      : "</llms.txt>; rel=\"describedby\"",
  );
  if (isPreviewHost(url.hostname)) headers.set("x-robots-tag", "noindex, follow");
  headers.delete("content-length");
  headers.delete("etag");

  return new Response(transformed.body, {
    status: transformed.status,
    statusText: transformed.statusText,
    headers,
  });
}
