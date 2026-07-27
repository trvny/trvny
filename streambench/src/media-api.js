const MAX_MANIFEST_BYTES = 2_000_000;
const MAX_ICY_BYTES = 512_000;
const FETCH_TIMEOUT_MS = 12_000;
const MANIFEST_CACHE_MS = 45_000;
const manifestCache = new Map();
let bundledCache = null;

function apiHeaders(extra = {}) {
  return {
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: apiHeaders({ "content-type": "application/json; charset=utf-8" }),
  });
}

function safeRemoteUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    if (isPrivateHost(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export function isPrivateHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return true;
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  return octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    || octets[0] >= 224;
}

function sameOriginBrowserRequest(request) {
  return request.headers.get("sec-fetch-site") === "same-origin";
}

async function bundledUrls(env, requestUrl) {
  if (!bundledCache) {
    bundledCache = (async () => {
      const assetUrl = new URL("/playlists/iptv.m3u8", requestUrl);
      const response = await env.ASSETS.fetch(new Request(assetUrl, {
        headers: { accept: "audio/x-mpegurl,text/plain" },
      }));
      if (!response.ok) throw new Error("bundled playlist unavailable");
      const text = await response.text();
      return new Set(text.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^https?:\/\//i.test(line))
        .map((line) => safeRemoteUrl(line)?.href)
        .filter(Boolean));
    })().catch((error) => {
      bundledCache = null;
      throw error;
    });
  }
  return bundledCache;
}

async function isBundledUrl(url, env, requestUrl) {
  return (await bundledUrls(env, requestUrl)).has(url.href);
}

function upstreamHeaders(request, { icy = false } = {}) {
  const headers = new Headers({
    accept: request.headers.get("accept") || "*/*",
    "user-agent": "Streambench/1.0 (+https://streambench.travny.workers.dev)",
  });
  for (const name of ["range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (icy) headers.set("Icy-MetaData", "1");
  return headers;
}

async function fetchWithTimeout(url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(response, limit) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new Error("response too large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error("response too large");
  return bytes;
}

function referencedUrls(source, baseUrl) {
  const urls = new Set();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith("#")) {
      try { urls.add(new URL(line, baseUrl).href); } catch {}
    }
    for (const match of line.matchAll(/URI=(?:"([^"]+)"|([^,\s]+))/gi)) {
      try { urls.add(new URL(match[1] || match[2], baseUrl).href); } catch {}
    }
  }
  return urls;
}

async function manifestSource(url) {
  const cached = manifestCache.get(url.href);
  if (cached && cached.expires > Date.now()) return cached;
  const response = await fetchWithTimeout(url, {
    headers: {
      accept: "application/vnd.apple.mpegurl,application/x-mpegURL,audio/mpegurl,text/plain",
      "user-agent": "Streambench/1.0 (+https://streambench.travny.workers.dev)",
    },
  });
  if (!response.ok) throw new Error(`manifest returned ${response.status}`);
  const text = new TextDecoder().decode(await readCapped(response, MAX_MANIFEST_BYTES));
  if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("not an HLS manifest");
  const result = {
    expires: Date.now() + MANIFEST_CACHE_MS,
    text,
    finalUrl: new URL(response.url || url.href),
  };
  manifestCache.set(url.href, result);
  if (manifestCache.size > 100) {
    const oldest = manifestCache.keys().next().value;
    manifestCache.delete(oldest);
  }
  return result;
}

async function childAllowed(source, parent, target) {
  if (parent.href !== source.href) {
    const rootManifest = await manifestSource(source);
    const rootReferences = referencedUrls(rootManifest.text, rootManifest.finalUrl);
    if (parent.href !== rootManifest.finalUrl.href && !rootReferences.has(parent.href)) return false;
  }
  const parentManifest = await manifestSource(parent);
  return referencedUrls(parentManifest.text, parentManifest.finalUrl).has(target.href);
}

function relayHref(target, source, parent, requestUrl) {
  const relay = new URL("/api/relay", requestUrl);
  relay.searchParams.set("url", target.href);
  relay.searchParams.set("source", source.href);
  relay.searchParams.set("parent", parent.href);
  return relay.href;
}

export function rewriteHlsManifest(source, currentUrl, sourceUrl, requestUrl) {
  const rewrite = (value) => {
    try {
      return relayHref(new URL(value, currentUrl), sourceUrl, currentUrl, requestUrl);
    } catch {
      return value;
    }
  };
  return source.split(/\r?\n/).map((rawLine) => {
    const line = rawLine.trim();
    if (!line) return rawLine;
    if (!line.startsWith("#")) return rewrite(line);
    return rawLine.replace(/URI=(?:"([^"]+)"|([^,\s]+))/gi, (_match, quoted, plain) => `URI="${rewrite(quoted || plain)}"`);
  }).join("\n");
}

function relayResponseHeaders(upstream, { manifest = false } = {}) {
  const headers = new Headers(apiHeaders({
    "x-streambench-relay": "1",
  }));
  for (const name of ["accept-ranges", "content-range", "icy-br", "icy-description", "icy-genre", "icy-name", "icy-url"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (manifest) {
    headers.set("content-type", "application/vnd.apple.mpegurl; charset=utf-8");
  } else {
    headers.set("content-type", upstream.headers.get("content-type") || "application/octet-stream");
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);
  }
  return headers;
}

async function relay(request, env, requestUrl) {
  if (!sameOriginBrowserRequest(request)) return json({ error: "same_origin_required" }, 403);
  const target = safeRemoteUrl(requestUrl.searchParams.get("url"));
  if (!target) return json({ error: "invalid_url" }, 400);
  const source = safeRemoteUrl(requestUrl.searchParams.get("source")) || target;
  const parent = safeRemoteUrl(requestUrl.searchParams.get("parent"));
  if (!await isBundledUrl(source, env, requestUrl)) return json({ error: "source_not_bundled" }, 403);
  if (parent && !await childAllowed(source, parent, target)) return json({ error: "manifest_reference_required" }, 403);
  if (!parent && target.href !== source.href) return json({ error: "invalid_source" }, 403);

  const upstream = await fetchWithTimeout(target, {
    method: request.method,
    headers: upstreamHeaders(request),
  });
  if (!upstream.ok && upstream.status !== 206) {
    upstream.body?.cancel();
    return json({ error: "upstream_unavailable", status: upstream.status }, 502);
  }
  if (request.method === "HEAD") {
    upstream.body?.cancel();
    return new Response(null, {
      status: upstream.status,
      headers: relayResponseHeaders(upstream),
    });
  }

  const contentType = upstream.headers.get("content-type") || "";
  const looksLikeManifest = /(?:mpegurl|m3u8)/i.test(contentType) || /\.m3u8(?:$|[?#])/i.test(target.href);
  if (!looksLikeManifest) {
    return new Response(upstream.body, {
      status: upstream.status,
      headers: relayResponseHeaders(upstream),
    });
  }
  const text = new TextDecoder().decode(await readCapped(upstream, MAX_MANIFEST_BYTES));
  if (!text.trimStart().startsWith("#EXTM3U")) {
    return new Response(text, {
      status: upstream.status,
      headers: relayResponseHeaders(upstream),
    });
  }
  const current = new URL(upstream.url || target.href);
  return new Response(rewriteHlsManifest(text, current, source, requestUrl), {
    status: upstream.status,
    headers: relayResponseHeaders(upstream, { manifest: true }),
  });
}

export function radioParadiseChannel(rawUrl) {
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (!/(^|\.)radioparadise\.com$/i.test(url.hostname)) return null;
  const path = url.pathname.toLowerCase();
  if (path.includes("rock")) return 2;
  if (path.includes("global") || path.includes("world")) return 3;
  if (/(?:^|[-_/])(?:mellow|192m)(?:[-_/]|$)/.test(path)) return 1;
  return 0;
}

function safeArtwork(value) {
  return safeRemoteUrl(value)?.href || "";
}

async function radioParadiseMetadata(channel) {
  const response = await fetchWithTimeout(`https://api.radioparadise.com/api/now_playing?chan=${channel}`, {
    headers: { accept: "application/json", "user-agent": "Streambench/1.0" },
  });
  if (!response.ok) throw new Error(`Radio Paradise returned ${response.status}`);
  const body = await response.json();
  return {
    provider: "radio-paradise",
    title: String(body.title || "").trim(),
    artist: String(body.artist || "").trim(),
    album: String(body.album || "").trim(),
    artwork: safeArtwork(body.cover || body.cover_med || body.cover_small),
    refreshAfter: 15,
  };
}

function parseStreamTitle(value) {
  const text = String(value || "").replace(/\0+$/g, "").trim();
  const match = text.match(/StreamTitle='([^']*)'/i);
  const combined = (match?.[1] || "").trim();
  const separator = combined.indexOf(" - ");
  return separator > 0
    ? { artist: combined.slice(0, separator).trim(), title: combined.slice(separator + 3).trim() }
    : { artist: "", title: combined };
}

async function icyMetadata(request, target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      headers: upstreamHeaders(request, { icy: true }),
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok || !response.body) throw new Error(`radio returned ${response.status}`);
    const interval = Number(response.headers.get("icy-metaint") || 0);
    if (!Number.isInteger(interval) || interval <= 0 || interval >= MAX_ICY_BYTES - 1) {
      response.body.cancel();
      return {
        provider: "icy",
        station: response.headers.get("icy-name") || "",
        title: "",
        artist: "",
        album: "",
        artwork: "",
        refreshAfter: 30,
      };
    }
    const reader = response.body.getReader();
    let bytes = new Uint8Array(0);
    while (bytes.byteLength <= interval && bytes.byteLength < MAX_ICY_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      const next = new Uint8Array(bytes.byteLength + value.byteLength);
      next.set(bytes);
      next.set(value, bytes.byteLength);
      bytes = next;
    }
    if (bytes.byteLength <= interval) {
      reader.cancel();
      throw new Error("ICY metadata missing");
    }
    const metadataLength = bytes[interval] * 16;
    const required = interval + 1 + metadataLength;
    while (bytes.byteLength < required && bytes.byteLength < MAX_ICY_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      const next = new Uint8Array(bytes.byteLength + value.byteLength);
      next.set(bytes);
      next.set(value, bytes.byteLength);
      bytes = next;
    }
    reader.cancel();
    const metadata = new TextDecoder("latin1").decode(bytes.slice(interval + 1, Math.min(required, bytes.byteLength)));
    const parsed = parseStreamTitle(metadata);
    return {
      provider: "icy",
      station: response.headers.get("icy-name") || "",
      title: parsed.title,
      artist: parsed.artist,
      album: "",
      artwork: "",
      refreshAfter: 20,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function metadata(request, env, requestUrl) {
  if (!sameOriginBrowserRequest(request)) return json({ error: "same_origin_required" }, 403);
  const target = safeRemoteUrl(requestUrl.searchParams.get("url"));
  if (!target) return json({ error: "invalid_url" }, 400);
  if (!await isBundledUrl(target, env, requestUrl)) return json({ error: "source_not_bundled" }, 403);
  const channel = radioParadiseChannel(target.href);
  const result = channel === null
    ? await icyMetadata(request, target)
    : await radioParadiseMetadata(channel);
  return json(result);
}

export async function handleMediaApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/relay" && url.pathname !== "/api/radio-metadata") return null;
  if (!["GET", "HEAD"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  try {
    return url.pathname === "/api/relay"
      ? await relay(request, env, url)
      : await metadata(request, env, url);
  } catch (error) {
    const code = error?.name === "AbortError" ? "upstream_timeout" : "upstream_unavailable";
    return json({ error: code }, 502);
  }
}
