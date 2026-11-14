import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sitemapEntries, sitemapVariants } from "../scripts/sitemap-variants.mjs";

test("alternate sitemaps cover both canonical XML maps", async () => {
  const documents = await Promise.all(["../site/sitemap.xml", "../astro/dist/przeglad/sitemap.xml"].map(path => readFile(new URL(path, import.meta.url), "utf8")));
  const entries = sitemapEntries(...documents);
  const variants = sitemapVariants(entries);
  assert.deepEqual(variants["sitemap.txt"].trim().split("\n"), entries.map(entry => entry.url));
  assert.deepEqual(JSON.parse(variants["sitemap.json"]), entries);
  assert.equal((variants["sitemap-atom.xml"].match(/<entry>/g) || []).length, entries.length);
  assert.equal((variants["sitemap-rss.xml"].match(/<item>/g) || []).length, entries.length);
  const robots = await readFile(new URL("../site/robots.txt", import.meta.url), "utf8");
  for (const [name, content] of Object.entries(variants)) {
    if (name.endsWith(".json")) continue;
    assert.ok(robots.includes("Sitemap: https://travny.pages.dev/" + name));
    for (const { url } of entries) assert.ok(content.includes(url));
  }
});
test("XML URL escaping round trips", () => {
  const url = "https://travny.pages.dev/?a=1&b=2";
  const entries = sitemapEntries("<urlset><url><loc>https://travny.pages.dev/?a=1&amp;b=2</loc></url></urlset>");
  assert.equal(entries[0].url, url);
  assert.match(sitemapVariants(entries)["sitemap-atom.xml"], /a=1&amp;b=2/);
});
