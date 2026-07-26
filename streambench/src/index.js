const IPTV_ORG_API = "https://iptv-org.github.io/api/";
const IPTV_ORG_PLAYLISTS = "https://iptv-org.github.io/iptv/";
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

  const response = await fetch(new URL(path, IPTV_ORG_PLAYLISTS), {
    headers: { accept: "audio/x-mpegurl,text/plain" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return json({ error: "provider_playlist_unavailable" }, 502);

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_PLAYLIST_BYTES) {
    return json({ error: "provider_playlist_too_large" }, 413);
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_PLAYLIST_BYTES) {
    return json({ error: "provider_playlist_too_large" }, 413);
  }

  const body = new TextDecoder().decode(bytes);
  if (!body.trimStart().startsWith("#EXTM3U")) {
    return json({ error: "invalid_provider_playlist" }, 502);
  }

  return new Response(body, {
    headers: {
      "content-type": "audio/x-mpegurl; charset=utf-8",
      "cache-control": "public, max-age=1800, stale-while-revalidate=21600",
      "x-streambench-source": "iptv-org",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return withSecurityHeaders(json({ status: "ok", service: "streambench" }));
    }

    if (url.pathname.startsWith("/api/providers/iptv-org/")) {
      if (request.method !== "GET") {
        return withSecurityHeaders(json({ error: "method_not_allowed" }, 405));
      }

      try {
        if (url.pathname === "/api/providers/iptv-org/catalog") {
          return withSecurityHeaders(await iptvOrgCatalog());
        }
        if (url.pathname === "/api/providers/iptv-org/playlist") {
          return withSecurityHeaders(await iptvOrgPlaylist(url));
        }
        return withSecurityHeaders(json({ error: "not_found" }, 404));
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
