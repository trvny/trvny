import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { argv } from "node:process";

const base = "https://travny.pages.dev/";
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (entity) => {
  const name = entity.slice(1, -1);
  if (name.startsWith("#x")) return String.fromCodePoint(parseInt(name.slice(2), 16));
  if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[name];
});
const declaration = '<?xml version="1.0" encoding="UTF-8"?>\n';
// Atom requires updated even for undated pages. Date of the sitemap entry,
// not an asserted page lastmod. Preserve actual digest dates when available.
const listingDate = "2026-11-14T00:00:00Z";

export function sitemapEntries(...documents) {
  const entries = new Map();
  for (const document of documents) {
    if (!document.includes("<urlset")) throw new Error("Expected sitemap urlset");
    for (const [, block] of document.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
      if (!loc) throw new Error("Missing sitemap loc");
      const url = decode(loc.trim());
      if (new URL(url).origin !== new URL(base).origin) throw new Error("Foreign sitemap URL");
      const lastmod = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1];
      entries.set(url, { url, ...(lastmod ? { lastmod } : {}) });
    }
  }
  if (!entries.size) throw new Error("Empty sitemap");
  return [...entries.values()];
}

export function sitemapVariants(entries) {
  const updated = (entry) => entry.lastmod ? new Date(entry.lastmod).toISOString() : listingDate;
  const feedUpdated = [listingDate, ...entries.map(updated)].sort().at(-1);
  const atom = entries.map((entry) => {
    const url = escape(entry.url);
    return `  <entry><id>${url}</id><title>${url}</title><link href="${url}"/><updated>${updated(entry)}</updated></entry>`;
  }).join("\n");
  const rss = entries.map((entry) => {
    const url = escape(entry.url);
    return `  <item><title>${url}</title><link>${url}</link><guid isPermaLink="true">${url}</guid></item>`;
  }).join("\n");
  return {
    "sitemap.txt": entries.map(({ url }) => url).join("\n") + "\n",
    "sitemap.json": JSON.stringify(entries, null, 2) + "\n",
    "sitemap-atom.xml": declaration + `<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${base}sitemap-atom.xml</id>
  <title>TRAVNY sitemap</title>
  <author><name>TRAVNY</name></author>
  <link rel="self" href="${base}sitemap-atom.xml"/>
  <link href="${base}"/>
  <updated>${feedUpdated}</updated>
${atom}
</feed>\n`,
    "sitemap-rss.xml": declaration + `<rss version="2.0"><channel>
  <title>TRAVNY sitemap</title>
  <link>${base}</link>
  <description>Canonical pages</description>
${rss}
</channel></rss>\n`,
  };
}

if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  const dir = new URL("../site/", import.meta.url);
  const documents = await Promise.all(["sitemap.xml", "przeglad/sitemap.xml"].map(name => readFile(new URL(name, dir), "utf8")));
  for (const [name, content] of Object.entries(sitemapVariants(sitemapEntries(...documents)))) {
    await writeFile(new URL(name, dir), content);
  }
}
