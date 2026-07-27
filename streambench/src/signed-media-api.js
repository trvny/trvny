import { isPrivateHost } from "./media-api.js";
import { verifySourceSignature } from "./source-signing.js";

const MAX_MANIFEST_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 12_000;
const MANIFEST_CACHE_MS = 45_000;
const manifestCache = new Map();

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

function sameOriginBrowserRequest(request) {
  return request.headers.get("sec-fetch-site") === "same-origin";
}

function upstreamHeaders(request) {
  const headers = new Headers({
    accept: request.headers.get("accept") || "*/*",
    "user-agent": "Streambench/1.0 (+https://streambench.travny.workers.dev)",
  });
  for (const name of ["range", "if-range"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

async function fetchValidated(rawUrl, init = {}, { signal } = {}) {
  let current = safeRemoteUrl(rawUrl);
  if (!current) throw new Error("invalid redirect target");
  const controller = signal ? null : new AbortController();
  const activeSignal = signal || controller.signal;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      const response = await fetch(current, {
        ...init,
        signal: activeSignal,
        redirect: "manual",
      });
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      response.body?.cancel();
      if (!location || redirectCount === 5) throw new Error("invalid redirect chain");
      current = safeRemoteUrl(new URL(location, current));
      if (!current) throw new Error("invalid redirect target");
    }
    throw new Error("too many redirects");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readCapped(response, limit) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new Error("response too large");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("response too large");
      }
      chunks.push(value);
    }
  } catch (error) {
    reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchCapped(url, init, limit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchValidated(url, init, { signal: controller.signal });
    const bytes = await readCapped(response, limit);
    return { response, bytes };
  } finally {
    clearTimeout(timer);
  }
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

async function manifestSource(url, { refresh = false } = {}) {
  const cached = manifestCache.get(url.href);
  if (!refresh && cached && cached.expires > Date.now()) return cached;
  const { response, bytes } = await fetchCapped(url, {
    headers: {
      accept: "application/vnd.apple.mpegurl,application/x-mpegURL,audio/mpegurl,text/plain",
      "user-agent": "Streambench/1.0 (+https://streambench.travny.workers.dev)",
    },
  }, MAX_MANIFEST_BYTES);
  if (!response.ok) throw new Error(`manifest returned ${response.status}`);
  const text = new TextDecoder().decode(bytes);
  if (!text.trimStart().startsWith("#EXTM3U")) throw new Error("not an HLS manifest");
  const result = {
    expires: Date.now() + MANIFEST_CACHE_MS,
    text,
    finalUrl: new URL(response.url || url.href),
  };
  manifestCache.set(url.href, result);
  if (manifestCache.size > 100) manifestCache.delete(manifestCache.keys().next().value);
  return result;
}

async function manifestReferences(parent, target) {
  let manifest = await manifestSource(parent);
  if (referencedUrls(manifest.text, manifest.finalUrl).has(target.href)) return true;
  manifest = await manifestSource(parent, { refresh: true });
  return referencedUrls(manifest.text, manifest.finalUrl).has(target.href);
}

async function childAllowed(source, parent, target) {
  if (parent.href !== source.href && !await manifestReferences(source, parent)) return false;
  return manifestReferences(parent, target);
}

function relayHref(target, source, parent, requestUrl, signature) {
  const relay = new URL("/api/relay", requestUrl);
  relay.searchParams.set("url", target.href);
  relay.searchParams.set("source", source.href);
  relay.searchParams.set("parent", parent.href);
  relay.searchParams.set("sig", signature);
  return relay.href;
}

export function rewriteSignedHlsManifest(
  source,
  currentUrl,
  sourceUrl,
  requestUrl,
  signature,
  authorizationParent = currentUrl,
) {
  const rewrite = (value) => {
    try {
      return relayHref(new URL(value, currentUrl), sourceUrl, authorizationParent, requestUrl, signature);
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
  const headers = new Headers(apiHeaders({ "x-streambench-relay": "signed-provider" }));
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

async function signedRelay(request, requestUrl, secret) {
  if (!sameOriginBrowserRequest(request)) return json({ error: "same_origin_required" }, 403);
  const target = safeRemoteUrl(requestUrl.searchParams.get("url"));
  if (!target) return json({ error: "invalid_url" }, 400);
  const source = safeRemoteUrl(requestUrl.searchParams.get("source")) || target;
  const parent = safeRemoteUrl(requestUrl.searchParams.get("parent"));
  const signature = requestUrl.searchParams.get("sig") || "";
  if (!await verifySourceSignature(source, signature, secret)) {
    return json({ error: "invalid_source_signature" }, 403);
  }
  if (parent && !await childAllowed(source, parent, target)) {
    return json({ error: "manifest_reference_required" }, 403);
  }
  if (!parent && target.href !== source.href) return json({ error: "invalid_source" }, 403);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetchValidated(target, {
      method: request.method,
      headers: upstreamHeaders(request),
    }, { signal: controller.signal });
  } catch (error) {
    clearTimeout(timer);
    throw error;
  }
  if (!upstream.ok && upstream.status !== 206) {
    clearTimeout(timer);
    upstream.body?.cancel();
    return json({ error: "upstream_unavailable", status: upstream.status }, 502);
  }
  if (request.method === "HEAD") {
    clearTimeout(timer);
    upstream.body?.cancel();
    return new Response(null, {
      status: upstream.status,
      headers: relayResponseHeaders(upstream),
    });
  }

  const contentType = upstream.headers.get("content-type") || "";
  const looksLikeManifest = /(?:mpegurl|m3u8)/i.test(contentType) || /\.m3u8?(?:$|[?#])/i.test(target.href);
  if (!looksLikeManifest) {
    clearTimeout(timer);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: relayResponseHeaders(upstream),
    });
  }

  let text;
  try {
    text = new TextDecoder().decode(await readCapped(upstream, MAX_MANIFEST_BYTES));
  } finally {
    clearTimeout(timer);
  }
  if (!text.trimStart().startsWith("#EXTM3U")) {
    return new Response(text, {
      status: upstream.status,
      headers: relayResponseHeaders(upstream),
    });
  }
  const current = new URL(upstream.url || target.href);
  return new Response(rewriteSignedHlsManifest(text, current, source, requestUrl, signature, target), {
    status: upstream.status,
    headers: relayResponseHeaders(upstream, { manifest: true }),
  });
}

export async function handleSignedMediaApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/relay" || !url.searchParams.has("sig")) return null;
  if (!["GET", "HEAD"].includes(request.method)) return json({ error: "method_not_allowed" }, 405);
  try {
    return await signedRelay(request, url, env.STREAMBENCH_RELAY_SECRET);
  } catch (error) {
    const code = error?.name === "AbortError" ? "upstream_timeout" : "upstream_unavailable";
    return json({ error: code }, 502);
  }
}
