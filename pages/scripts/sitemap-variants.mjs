import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function pruneDigestEntries(document) {
  return document.replace(/[ \t]*<url>[\s\S]*?<\/url>(?:[ \t]*\r?\n)?/g, (entry) => {
    const loc = entry.match(/<loc>([^<]+)<\/loc>/)?.[1];
    if (!loc) return entry;
    const { pathname } = new URL(loc.trim());
    return /^\/przeglad\/.+/.test(pathname) ? "" : entry;
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sitemap = new URL("../site/sitemap.xml", import.meta.url);
  const source = await readFile(sitemap, "utf8");
  const pruned = pruneDigestEntries(source);
  if (pruned !== source) await writeFile(sitemap, pruned);
}
