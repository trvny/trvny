// Fixed-origin TVPI adapter. Stream bytes and signed HLS stay on TVPI.
export const TVPI_ORIGIN = "https://tvpi.travny.workers.dev";
export const HUB_TV_ORIGIN = "https://bartek.lol/tv";
const SLUG = /^[a-z0-9-]{1,32}$/;
const REMOTE_TIMEOUT_MS = 5000;

async function readJson(context, pathname, fetchImpl = fetch) {
  const url = TVPI_ORIGIN + pathname;
  const init = {
    method: "GET",
    headers: { Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
  };
  const binding = context?.env?.TVPI_SERVICE;
  let response;
  if (binding) {
    try {
      response = await binding.fetch(new Request(url, init));
    } catch (error) {
      if (init.signal.aborted) throw error;
      response = await fetchImpl(url, init);
    }
  } else {
    response = await fetchImpl(url, init);
  }
  if (!response.ok) throw new Error("TVPI unavailable");
  return response.json();
}

function validChannel(ch) {
  return ch && typeof ch === "object"
    && typeof ch.slug === "string" && SLUG.test(ch.slug)
    && typeof ch.id === "string" && /^\d{1,20}$/.test(ch.id)
    && typeof ch.number === "string" && /^\d{3}$/.test(ch.number)
    && typeof ch.name === "string" && ch.name.length > 0 && ch.name.length <= 100
    && typeof ch.group === "string" && ch.group.length <= 60
    && typeof ch.logo === "string" && ch.logo.length <= 300
    && /^https:\/\/s\.tvp\.pl\//.test(ch.logo);
}

export async function tvCatalog(context, fetchImpl = fetch) {
  const raw = await readJson(context, "/api/channels", fetchImpl);
  if (!Array.isArray(raw.channels) || raw.channels.length < 1 || raw.channels.length > 32
    || raw.channels.some(ch => !validChannel(ch))) throw new Error("Invalid TVPI catalog");
  const seen = new Set();
  const channels = raw.channels.map(ch => {
    if (seen.has(ch.slug)) throw new Error("Duplicate channel slug");
    seen.add(ch.slug);
    return {
      id: ch.id, number: ch.number, slug: ch.slug,
      name: ch.name, group: ch.group, logo: ch.logo,
      streamUrl: HUB_TV_ORIGIN + "/" + ch.slug + ".m3u8",
    };
  });
  return { version: 1, playlistUrl: HUB_TV_ORIGIN + "/playlist.m3u", channels };
}

export async function tvStatus(context, fetchImpl = fetch) {
  const raw = await readJson(context, "/api/status", fetchImpl);
  if (!Array.isArray(raw.channels) || raw.channels.length > 32) throw new Error("Invalid TVPI status");
  return {
    version: 1,
    generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : null,
    meaning: "R2 pushed-manifest freshness only; playback not verified.",
    channels: raw.channels.filter(item => item && typeof item.slug === "string"
      && SLUG.test(item.slug)
      && ["fresh", "stale", "missing", "unknown"].includes(item.manifest))
      .map(item => ({
        slug: item.slug, manifest: item.manifest,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : null,
      })),
  };
}

function safeM3uValue(value) {
  return String(value).replace(/[\r\n"\\]/g, " ").slice(0, 300);
}

export function buildHubPlaylist(channels) {
  const lines = ["#EXTM3U"];
  for (const ch of channels) {
    lines.push(
      '#EXTINF:-1 tvg-id="' + safeM3uValue(ch.id)
        + '" tvg-name="' + safeM3uValue(ch.name)
        + '" tvg-logo="' + safeM3uValue(ch.logo)
        + '" group-title="' + safeM3uValue(ch.group)
        + '",' + safeM3uValue(ch.name),
      HUB_TV_ORIGIN + "/" + ch.slug + ".m3u8",
    );
  }
  return lines.join("\n") + "\n";
}

function reply(request, value, contentType, status = 200) {
  const headers = {
    "Content-Type": contentType, "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "X-Robots-Tag": "noindex, nofollow",
  };
  const body = request.method === "HEAD" ? null : value;
  return new Response(body, { status, headers });
}

export async function tvRoute(context, url, fetchImpl = fetch) {
  const path = url.pathname;
  if (!path.startsWith("/tv/")) return null;
  const isStream = /^\/tv\/([a-z0-9-]{1,32})\.m3u8$/.exec(path);
  const isOneM3u = /^\/tv\/([a-z0-9-]{1,32})\.m3u$/.exec(path);
  const api = path === "/tv/api/channels" || path === "/tv/api/status";
  const playlist = path === "/tv/playlist.m3u";
  if (!(isStream || isOneM3u || api || playlist)) return null;
  if (!["GET", "HEAD"].includes(context.request.method)) {
    return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  if (isStream) {
    const response = Response.redirect(TVPI_ORIGIN + "/" + isStream[1] + ".m3u8", 302);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("X-Robots-Tag", "noindex, nofollow");
    return new Response(null, { status: 302, headers });
  }
  try {
    if (path === "/tv/api/status") {
      return reply(context.request, JSON.stringify(await tvStatus(context, fetchImpl)),
        "application/json; charset=utf-8");
    }
    const catalog = await tvCatalog(context, fetchImpl);
    if (path === "/tv/api/channels") {
      return reply(context.request, JSON.stringify(catalog),
        "application/json; charset=utf-8");
    }
    const channels = isOneM3u && !playlist
      ? catalog.channels.filter(ch => ch.slug === isOneM3u[1])
      : catalog.channels;
    if (!channels.length) return reply(context.request, "Not found\n", "text/plain; charset=utf-8", 404);
    return reply(context.request, buildHubPlaylist(channels), "application/x-mpegurl; charset=utf-8");
  } catch {
    return reply(context.request, "TVPI metadata temporarily unavailable\n",
      "text/plain; charset=utf-8", 503);
  }
}
