// Explicit Markdown variants only; never guess a filesystem path from Accept.
const ATLAS = "/teksty/githubowa-kraina";
const ATLAS_PATHS = new Set([ATLAS, ATLAS + "/", ATLAS + "/index.html"]);
const RADIO = "/radio";
const RADIO_PATHS = new Set([RADIO, RADIO + "/", RADIO + "/index.html"]);
export const isStaticMarkdownPage = pathname => ATLAS_PATHS.has(pathname) || RADIO_PATHS.has(pathname);
const PATHS = new Map([
  ...[...ATLAS_PATHS].map(path => [path, ATLAS + "/index.md"]),
  ...[...RADIO_PATHS].map(path => [path, RADIO + "/index.md"]),
  ["/", "/index.md"], ["/index.html", "/index.md"],
  ["/tv", "/tv/index.md"], ["/tv/", "/tv/index.md"], ["/tv/index.html", "/tv/index.md"],
  ["/teksty", "/teksty/index.md"], ["/teksty/", "/teksty/index.md"], ["/teksty/index.html", "/teksty/index.md"],
]);

export function markdownPath(pathname) {
  return PATHS.get(pathname) || null;
}

export function prefersMarkdown(accept = "") {
  const types = new Map();
  for (const entry of accept.split(",")) {
    const [raw, ...params] = entry.trim().toLowerCase().split(";");
    const quality = params.map(p => p.trim()).find(p => p.startsWith("q="));
    const q = quality ? Number(quality.slice(2)) : 1;
    if (raw && Number.isFinite(q) && q >= 0 && q <= 1) types.set(raw.trim(), q);
  }
  const md = types.get("text/markdown") ?? 0;
  const html = types.get("text/html") ?? types.get("text/*") ?? types.get("*/*") ?? 0;
  return md > 0 && md >= html;
}

export function varyAccept(headers) {
  const values = (headers.get("vary") || "").split(",").map(value => value.trim()).filter(Boolean);
  if (!values.some(value => ["accept", "*"].includes(value.toLowerCase()))) values.push("Accept");
  headers.set("vary", values.join(", "));
}

export function withMarkdownVary(response, pathname) {
  if (!markdownPath(pathname)) return response;
  const headers = new Headers(response.headers);
  varyAccept(headers);
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers,
  });
}

export async function negotiateMarkdown(context, url) {
  const path = markdownPath(url.pathname);
  if (!path || !["GET", "HEAD"].includes(context.request.method)
    || !prefersMarkdown(context.request.headers.get("accept") || "")
    || !context.env?.ASSETS?.fetch) return null;
  const assetUrl = new URL(path, url.origin);
  let asset;
  try {
    asset = await context.env.ASSETS.fetch(new Request(assetUrl, { method: context.request.method }));
  } catch {
    return null;
  }
  if (!asset.ok) return null;
  const headers = new Headers(asset.headers);
  for (const name of ["content-length", "content-encoding", "etag", "last-modified", "content-range"]) headers.delete(name);
  headers.set("content-type", "text/markdown; charset=utf-8");
  headers.set("cache-control", "private, no-store");
  varyAccept(headers);
  headers.set("link", '<' + path + '>; rel="alternate"; type="text/markdown", </llms.txt>; rel="describedby"');
  return new Response(context.request.method === "HEAD" ? null : asset.body, { headers });
}
