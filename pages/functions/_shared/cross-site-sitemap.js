// Sitemap aliases and the legacy verified-domain index.
import { ORIGIN } from "./page-seo.js";

const LEGACY_ORIGIN = "https://trfny.com";
const INDEX = "/sitemap-cross-site.xml";
const LEGACY_MAPS = new Map([
  ["/sitemaps/travny.xml", { asset: "/sitemap.xml" }],
  ["/sitemaps/digests.xml", { asset: "/przeglad/sitemap.xml" }],
  ["/sitemaps/feedseek.xml", { url: "https://trvny.github.io/feedseek/sitemap.xml" }],
]);
const HUB_ORIGINS = new Set([ORIGIN, "https://travny.pages.dev"]);
const RETIRED_MAPS = new Set([
  INDEX,
  "/sitemap-index.xml",
  "/przeglad/sitemap.xml",
  "/sitemap.txt",
  "/sitemap.json",
  "/sitemap-atom.xml",
  "/sitemap-rss.xml",
  ...["travny", "digests", "codebench", "docbench", "streambench", "weather", "shitpost"]
    .map(name => `/sitemaps/${name}.xml`),
]);

function xml(body, method) {
  return new Response(method === "HEAD" ? null : body, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}

export async function crossSiteSitemap(context, url, fetchImpl = fetch) {
  const method = context.request.method;
  if (!["GET", "HEAD"].includes(method)) return null;
  if (HUB_ORIGINS.has(url.origin) && RETIRED_MAPS.has(url.pathname)) {
    return Response.redirect(url.origin + "/sitemap.xml" + url.search, 301);
  }
  if (url.origin !== LEGACY_ORIGIN) return null;

  if (url.pathname === INDEX) {
    const entries = [...LEGACY_MAPS.keys()].map(path => `  <sitemap><loc>${url.origin}${path}</loc></sitemap>`);
    return xml(['<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries, "</sitemapindex>", ""].join("\n"), method);
  }

  const source = LEGACY_MAPS.get(url.pathname);
  if (!source) return null;
  try {
    const response = source.asset
      ? await context.env.ASSETS.fetch(new URL(source.asset, url.origin).href)
      : await fetchImpl(source.url, { method, redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (!response.ok || !/^(?:application|text)\/xml(?:;|$)/i.test(response.headers.get("content-type") || "")) {
      throw new Error("Sitemap unavailable");
    }
    return xml(method === "HEAD" ? null : await response.text(), method);
  } catch {
    return new Response(method === "HEAD" ? null : "Sitemap unavailable", {
      status: 503, headers: { "cache-control": "no-store", "retry-after": "300" },
    });
  }
}
