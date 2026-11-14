import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { escapeXml, sitemapEntries, sitemapVariants, writeSitemapVariants } from "../scripts/sitemap-variants.mjs";

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
    if (name.endsWith(".json")) {
      assert.ok(!robots.includes("Sitemap: https://travny.pages.dev/" + name));
      continue;
    }
    assert.ok(robots.includes("Sitemap: https://travny.pages.dev/" + name));
    for (const { url } of entries) assert.ok(content.includes(name.endsWith(".xml") ? escapeXml(url) : url));
  }
});
test("XML URL escaping round trips", () => {
  const url = "https://travny.pages.dev/?a=1&b=2";
  const entries = sitemapEntries("<urlset><url><loc>https://travny.pages.dev/?a=1&amp;b=2</loc></url></urlset>");
  assert.equal(entries[0].url, url);
  assert.match(sitemapVariants(entries)["sitemap-atom.xml"], /a=1&amp;b=2/);
  assert.match(sitemapVariants(entries)["sitemap-rss.xml"], /a=1&amp;b=2/);
  assert.match(sitemapVariants(entries)["sitemap-atom.xml"], /<summary>.*<\/summary>/);
});

test("write all variants of built root and digest maps", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sitemap-"));
  try {
    await mkdir(join(dir, "przeglad"));
    await copyFile(new URL("../site/sitemap.xml", import.meta.url), join(dir, "sitemap.xml"));
    await copyFile(new URL("../astro/dist/przeglad/sitemap.xml", import.meta.url), join(dir, "przeglad/sitemap.xml"));
    await writeSitemapVariants(pathToFileURL(dir + "/"));
    for (const name of ["sitemap.txt", "sitemap.json", "sitemap-atom.xml", "sitemap-rss.xml"]) {
      assert.ok((await readFile(join(dir, name), "utf8")).length > 0);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("Atom snapshots advance and verified dates are preserved", () => {
  const entries = [{ url: "https://travny.pages.dev/" }, { url: "https://travny.pages.dev/przeglad/1/", lastmod: "2026-11-01" }];
  const date = "2026-11-15T00:00:00Z";
  const variants = sitemapVariants(entries, date);
  assert.ok(variants["sitemap-atom.xml"].includes(date));
  assert.ok(variants["sitemap-atom.xml"].includes("2026-11-01T00:00:00.000Z"));
  assert.match(variants["sitemap-rss.xml"], /<pubDate>Sun, 01 Nov 2026/);
});
