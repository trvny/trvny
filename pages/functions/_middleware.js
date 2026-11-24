import { isStaticMarkdownPage, markdownPath, negotiateMarkdown, varyAccept, withMarkdownVary } from "./_shared/markdown.js";
import { NAV_BODY, pageShellHead } from "./_shared/page-shell.js";
import { serviceFetch, WEATHER_STATE_URL } from "./_shared/service-fetch.js";
import { ORIGIN } from "./_shared/page-seo.js";
import { crossSiteSitemap } from "./_shared/cross-site-sitemap.js";
import { tvCatalog, tvRoute } from "./_shared/tv-api.js";

// Edge rules also cover static paths that bypass Functions.
const CANONICAL_HOST = new URL(ORIGIN).hostname;
const REDIRECT_HOSTS = new Set(["tvpi.pages.dev", "trfny.com", "www.trfny.com", "www.bartek.lol"]);
const FEED_ALIAS_HOSTS = new Set(["trfny.com", "www.trfny.com"]);
const PREVIEW_SUFFIX = ".travny.pages.dev";
const AGENT_DISCOVERY = new Map([
  ["/.well-known/ard.json", "application/ard+json"],
  ["/.well-known/ai-catalog.json", "application/ai-catalog+json"],
]);

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
async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 4500, parse = "text") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) return { ok: false, body: null };
    return { ok: true, body: parse === "json" ? await response.json() : await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function getWeather(context) {
  try {
    const { ok, body } = await fetchWithTimeout(serviceFetch(context, 'WEATHER_SERVICE'), WEATHER_STATE_URL, {
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
async function getChannels(context) {
  try {
    const { channels } = await tvCatalog(context);
    return channels.map(ch => ({
      ...ch, no: ch.number, tag: ch.slug.toUpperCase(), status: null,
    }));
  } catch {
    return [];
  }
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
  const url = new URL(context.request.url);

  const sitemap = await crossSiteSitemap(context, url);
  if (sitemap) return sitemap;

  // Mirror the zone rule when a request reaches Functions directly.
  if (FEED_ALIAS_HOSTS.has(url.hostname) && url.pathname.startsWith("/f/")) {
    const destination = new URL("https://trvny.github.io");
    destination.pathname = "/feedseek/" + url.pathname.split("/").slice(2).join("/");
    destination.search = url.search;
    return Response.redirect(destination.href, 301);
  }

  if (REDIRECT_HOSTS.has(url.hostname)) {
    url.protocol = "https:";
    url.hostname = CANONICAL_HOST;
    url.port = "";
    return withMarkdownVary(Response.redirect(url.toString(), 301), url.pathname);
  }

  if ((context.request.method === "GET" || context.request.method === "HEAD")
    && ["/teksty/grass-mud-horse-pl", "/teksty/grass-mud-horse-pl/", "/teksty/grass-mud-horse-pl/index.html"].includes(url.pathname)) {
    url.pathname = "/teksty/grass-mud-horse/";
    url.searchParams.set("lang", "pl");
    return Response.redirect(url.toString(), 301);
  }

  // Former duplicate of the Token Worldcup index; build no longer publishes it.
  if ((context.request.method === "GET" || context.request.method === "HEAD")
    && ["/teksty/token-worldcup/token-worldcup", "/teksty/token-worldcup/token-worldcup.html"].includes(url.pathname)) {
    url.pathname = "/teksty/token-worldcup/";
    return Response.redirect(url.toString(), 301);
  }

  if ((context.request.method === "GET" || context.request.method === "HEAD")
    && AGENT_DISCOVERY.has(url.pathname)) {
    const asset = await context.next();
    if (!asset.ok) return withPreviewNoindex(asset, url.hostname);
    const headers = new Headers(asset.headers);
    headers.set("content-type", AGENT_DISCOVERY.get(url.pathname) + "; charset=utf-8");
    headers.set("access-control-allow-origin", "*");
    return withPreviewNoindex(new Response(context.request.method === "HEAD" ? null : asset.body, {
      status: asset.status,
      statusText: asset.statusText,
      headers,
    }), url.hostname);
  }

  const tvResponse = await tvRoute(context, url);
  if (tvResponse) return withPreviewNoindex(tvResponse, url.hostname);

  const markdown = await negotiateMarkdown(context, url);
  if (markdown) return withPreviewNoindex(markdown, url.hostname);

  // The atlas already has the build-time shell. Do not inject it a second time.
  if (isStaticMarkdownPage(url.pathname)) {
    const asset = await context.next();
    return withPreviewNoindex(withMarkdownVary(asset, url.pathname), url.hostname);
  }

  if (context.request.method !== "GET") {
    const result = withPreviewNoindex(await context.next(), url.hostname);
    return context.request.method === "HEAD"
      ? withMarkdownVary(result, url.pathname)
      : result;
  }

  const page = identifyPage(url.pathname);
  const isEnglishPage = page === "grass-mud-horse" || page === "papagenerator"
    || url.pathname === "/lab" || url.pathname.startsWith("/lab/");
  const pageLanguage = page === "grass-mud-horse" && url.searchParams.get("lang") === "pl"
    ? "pl" : (isEnglishPage ? "en" : "pl");
  const needsChannels = page === "home";
  const needsWeather = page === "home";
  const [assetResponse, channels, weatherState] = await Promise.all([
    context.next(),
    needsChannels ? getChannels(context) : Promise.resolve([]),
    needsWeather ? getWeather(context) : Promise.resolve(null),
  ]);

  const contentType = assetResponse.headers.get("content-type") || "";
  if (!assetResponse.ok || !contentType.includes("text/html")) {
    return withPreviewNoindex(withMarkdownVary(assetResponse, url.pathname), url.hostname);
  }

  const online = channels.filter((channel) => channel.status === true).length;
  const known = channels.some((channel) => channel.status !== null);
  const countText = known ? `${online}/${channels.length}` : `—/${channels.length || "?"}`;

  let rewriter = new globalThis.HTMLRewriter()
    .on("html", new SetAttribute("lang", pageLanguage))
    .on("head", new AppendHtml(pageShellHead(url.pathname, page)))
    .on("body", new AppendHtml(NAV_BODY));

  if (page === "home") {
    rewriter = rewriter
      .on("#tvchips", new SetText(renderHubChips(channels), true))
      .on("#tvbig", new SetText(countText))
      .on("#tvcount", new SetText(`${countText} MANIFESTY`));

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
  }

  const transformed = rewriter.transform(assetResponse);
  const headers = new Headers(transformed.headers);
  headers.set("cache-control", "public, max-age=0, s-maxage=120, stale-while-revalidate=300");
  headers.set("content-language", pageLanguage);

  const alternate = markdownPath(url.pathname)
    || (page === "githubowa-kraina" ? "/teksty/githubowa-kraina/index.md" : null);
  if (markdownPath(url.pathname)) varyAccept(headers);
  headers.set(
    "link",
    alternate
      ? `<${alternate}>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"`
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
