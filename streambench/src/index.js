import { FREE_TV_COUNTRIES, filterFreeTvPlaylist } from "./providers/free-tv.js";
import { providerById, providerManifest } from "./providers/registry.js";

const IPTV_ORG_API = "https://iptv-org.github.io/api/";
const IPTV_ORG_PLAYLISTS = "https://iptv-org.github.io/iptv/";
const FREE_TV_PLAYLIST = "https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8";
const MAX_PLAYLIST_BYTES = 5_000_000;

const SECURITY_HEADERS = {
  "content-security-policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob: https: http:",
    "media-src 'self' blob: https: http:",
    "connect-src 'self' blob: https: http:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; "),
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function json(body, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function readPlaylist(response) {
  if (!response.ok) return { error: json({ error: "provider_playlist_unavailable" }, 502) };

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_PLAYLIST_BYTES) {
    return { error: json({ error: "provider_playlist_too_large" }, 413) };
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_PLAYLIST_BYTES) {
    return { error: json({ error: "provider_playlist_too_large" }, 413) };
  }

  const body = new TextDecoder().decode(bytes);
  if (!body.trimStart().startsWith("#EXTM3U")) {
    return { error: json({ error: "invalid_provider_playlist" }, 502) };
  }
  return { body };
}

async function fetchIptvOrg(path, accept) {
  const response = await fetch(new URL(path, IPTV_ORG_API), {
    headers: { accept },
    redirect: "follow",
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) throw new Error(`iptv-org returned ${response.status}`);
  return response;
}

async function iptvOrgCatalog() {
  const [countriesResponse, categoriesResponse] = await Promise.all([
    fetchIptvOrg("countries.json", "application/json"),
    fetchIptvOrg("categories.json", "application/json"),
  ]);
  const [countriesSource, categoriesSource] = await Promise.all([
    countriesResponse.json(),
    categoriesResponse.json(),
  ]);

  if (!Array.isArray(countriesSource) || !Array.isArray(categoriesSource)) {
    throw new Error("invalid iptv-org catalog");
  }

  const countries = countriesSource
    .filter((country) => /^[A-Z]{2}$/.test(country.code) && typeof country.name === "string")
    .map((country) => ({ code: country.code, name: country.name, flag: country.flag || "" }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const categories = categoriesSource
    .filter((category) => (
      /^[a-z0-9-]+$/.test(category.id)
      && typeof category.name === "string"
      && category.id !== "xxx"
      && category.id !== "undefined"
    ))
    .map((category) => ({ id: category.id, name: category.name }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));

  return json(
    { provider: "iptv-org", countries, categories },
    200,
    "public, max-age=21600, stale-while-revalidate=86400",
  );
}

function iptvOrgPlaylistPath(url) {
  const type = url.searchParams.get("type");
  const id = url.searchParams.get("id") || "";

  if (type === "country" && /^[a-z]{2}$/i.test(id)) {
    return `countries/${id.toLowerCase()}.m3u`;
  }
  if (type === "category" && /^[a-z0-9-]+$/.test(id)) {
    return `categories/${id}.m3u`;
  }
  return null;
}

async function iptvOrgPlaylist(url) {
  const path = iptvOrgPlaylistPath(url);
  if (!path) return json({ error: "invalid_provider_selection" }, 400);

  const source = await readPlaylist(await fetch(new URL(path, IPTV_ORG_PLAYLISTS), {
    headers: { accept: "audio/x-mpegurl,text/plain" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  }));
  if (source.error) return source.error;

  return new Response(source.body, {
    headers: {
      "content-type": "audio/x-mpegurl; charset=utf-8",
      "cache-control": "public, max-age=1800, stale-while-revalidate=21600",
      "x-streambench-source": "iptv-org",
    },
  });
}

function freeTvCatalog() {
  return json(
    {
      provider: "free-tv",
      countries: FREE_TV_COUNTRIES,
      filters: providerById("free-tv").filters,
    },
    200,
    "public, max-age=86400, stale-while-revalidate=604800",
  );
}

async function freeTvPlaylist(url) {
  const type = url.searchParams.get("type");
  const id = (url.searchParams.get("id") || "").toUpperCase();
  if (type !== "country" || !FREE_TV_COUNTRIES.some((entry) => entry.code === id)) {
    return json({ error: "invalid_provider_selection" }, 400);
  }

  const source = await readPlaylist(await fetch(FREE_TV_PLAYLIST, {
    headers: { accept: "audio/x-mpegurl,text/plain" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  }));
  if (source.error) return source.error;

  const filtered = filterFreeTvPlaylist(source.body, id);
  return new Response(filtered.body, {
    headers: {
      "content-type": "audio/x-mpegurl; charset=utf-8",
      "cache-control": "public, max-age=1800, stale-while-revalidate=21600",
      "x-streambench-source": "free-tv",
      "x-streambench-lite-count": String(filtered.count),
      "x-streambench-source-count": String(filtered.total),
    },
  });
}

function providersResponse() {
  return json(
    { providers: providerManifest() },
    200,
    "public, max-age=86400, stale-while-revalidate=604800",
  );
}

async function catalogResponse(providerId) {
  if (providerId === "free-tv") return freeTvCatalog();
  if (providerId === "iptv-org") return iptvOrgCatalog();
  return json({ error: "unknown_provider" }, 400);
}

async function playlistResponse(providerId, url) {
  if (providerId === "free-tv") return freeTvPlaylist(url);
  if (providerId === "iptv-org") return iptvOrgPlaylist(url);
  return json({ error: "unknown_provider" }, 400);
}

function legacyProviderRoute(pathname) {
  const match = pathname.match(/^\/api\/providers\/([a-z0-9-]+)\/(catalog|playlist)$/);
  return match ? { providerId: match[1], resource: match[2] } : null;
}

async function providerResponse(url) {
  if (url.pathname === "/api/providers") return providersResponse();

  if (url.pathname === "/api/catalog" || url.pathname === "/api/playlist") {
    const providerId = url.searchParams.get("provider") || "";
    if (!providerById(providerId)) return json({ error: "unknown_provider" }, 400);
    return url.pathname === "/api/catalog"
      ? catalogResponse(providerId)
      : playlistResponse(providerId, url);
  }

  const legacy = legacyProviderRoute(url.pathname);
  if (!legacy || !providerById(legacy.providerId)) return json({ error: "not_found" }, 404);
  return legacy.resource === "catalog"
    ? catalogResponse(legacy.providerId)
    : playlistResponse(legacy.providerId, url);
}

function isProviderRoute(pathname) {
  return pathname === "/api/providers"
    || pathname === "/api/catalog"
    || pathname === "/api/playlist"
    || pathname.startsWith("/api/providers/");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return withSecurityHeaders(json({ status: "ok", service: "streambench" }));
    }

    if (isProviderRoute(url.pathname)) {
      if (request.method !== "GET") {
        return withSecurityHeaders(json({ error: "method_not_allowed" }, 405));
      }

      try {
        return withSecurityHeaders(await providerResponse(url));
      } catch {
        return withSecurityHeaders(json({ error: "provider_unavailable" }, 502));
      }
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return withSecurityHeaders(json({ error: "method_not_allowed" }, 405));
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
