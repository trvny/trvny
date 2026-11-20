import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { argv } from "node:process";

const host = "bartek.lol";
const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
  const name = entity.slice(1, -1);
  if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
  if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name];
});
const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';

export function sitemapEntries(...documents) {
  const entries = new Map();
  for (const document of documents) {
    if (!document.includes("<urlset")) throw new Error("Expected sitemap urlset");
    for (const [, block] of document.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
      if (!loc) throw new Error("Missing sitemap loc");
      const url = decode(loc.trim());
      const { protocol, hostname, username, password, port } = new URL(url);
      if (protocol !== "https:" || username || password || port ||
          (hostname !== host && !hostname.endsWith("." + host))) {
        throw new Error("Foreign sitemap URL");
      }
      const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
      entries.set(url, { url, ...(lastmod ? { lastmod } : {}) });
    }
  }
  if (!entries.size) throw new Error("Empty sitemap");
  return [...entries.values()];
}

export function combineSitemaps(...documents) {
  const rows = sitemapEntries(...documents).map(({ url, lastmod }) =>
    `  <url><loc>${escapeXml(url)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`);
  return declaration + [
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...rows,
    "</urlset>",
    "",
  ].join("\n");
}

export async function writeSitemap(dir) {
  const output = new URL("sitemap.xml", dir);
  const digests = new URL("przeglad/sitemap.xml", dir);
  const documents = await Promise.all([output, digests].map(url => readFile(url, "utf8")));
  await writeFile(output, combineSitemaps(...documents));
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  await writeSitemap(new URL("../site/", import.meta.url));
}
