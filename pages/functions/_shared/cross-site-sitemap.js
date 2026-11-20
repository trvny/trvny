// Cross-site submission for verified properties; source maps remain canonical.
import { ORIGIN } from "./page-seo.js";

const LEGACY_ORIGIN = "https://trfny.com";
const INDEX = "/sitemap-cross-site.xml";
const HUB_MAPS = [
  ["/sitemaps/travny.xml", { asset: "/sitemap.xml" }],
  ["/sitemaps/digests.xml", { asset: "/przeglad/sitemap.xml" }],
];
const MAPS_BY_ORIGIN = new Map([
  [LEGACY_ORIGIN, new Map([
    ...HUB_MAPS,
    ["/sitemaps/feedseek.xml", { url: "https://trvny.github.io/feedseek/sitemap.xml" }],
  ])],
  [ORIGIN, new Map([
    ...HUB_MAPS,
    ...["codebench", "docbench", "streambench", "weather", "shitpost"].map((service) => [
      `/sitemaps/${service}.xml`,
      { url: `https://${service}.${new URL(ORIGIN).hostname}/sitemap.xml` },
    ]),
  ])],
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
  const sources = MAPS_BY_ORIGIN.get(url.origin);
  if (!sources || !["GET", "HEAD"].includes(method)) return null;

  if (url.pathname === INDEX) {
    const entries = [...sources.keys()].map(path => `  <sitemap><loc>${url.origin}${path}</loc></sitemap>`);
    return xml(['<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...entries, "</sitemapindex>", ""].join("\n"), method);
  }

  const source = sources.get(url.pathname);
  if (!source) return null;
  try {
    const response = source.asset
      ? await context.env.ASSETS.fetch(new URL(source.asset, url.origin).href)
      : await fetchImpl(source.url, { redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (!response.ok || !/^(?:application|text)\/xml(?:;|$)/i.test(response.headers.get("content-type") || "")) {
      throw new Error("Sitemap unavailable");
    }
    return xml(response.body, method);
  } catch {
    return new Response(method === "HEAD" ? null : "Sitemap unavailable", {
      status: 503, headers: { "cache-control": "no-store", "retry-after": "300" },
    });
  }
}
