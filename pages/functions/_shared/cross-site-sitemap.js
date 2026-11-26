// Redirect retired sitemap aliases to canonical XML.
import { ORIGIN } from "./page-seo.js";

const HUB_ORIGINS = new Set([ORIGIN, "https://travny.pages.dev", "https://trfny.com", "https://www.trfny.com"]);
const FEEDSEEK_MAP = "/sitemaps/feedseek.xml";
const RETIRED_MAPS = new Set([
  "/sitemap-cross-site.xml",
  "/sitemap-index.xml",
  "/przeglad/sitemap.xml",
  "/sitemap.txt",
  "/sitemap.json",
  "/sitemap-atom.xml",
  "/sitemap-rss.xml",
  ...["travny", "digests", "codebench", "docbench", "streambench", "weather", "shitpost"]
    .map(name => `/sitemaps/${name}.xml`),
]);

export async function crossSiteSitemap(context, url) {
  const method = context.request.method;
  if (!["GET", "HEAD"].includes(method) || !HUB_ORIGINS.has(url.origin)) return null;
  if (url.pathname === FEEDSEEK_MAP) {
    return Response.redirect("https://rss.bartek.lol/sitemap.xml" + url.search, 301);
  }
  if (RETIRED_MAPS.has(url.pathname)
    || (url.origin !== ORIGIN && url.pathname === "/sitemap.xml")) {
    return Response.redirect(ORIGIN + "/sitemap.xml" + url.search, 301);
  }
  return null;
}
