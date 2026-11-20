import test from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, mkdir, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { combineSitemaps, sitemapEntries, writeSitemap } from "../scripts/sitemap-variants.mjs";

test("built sitemap includes hub, published digests and subdomain pages", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sitemap-"));
  try {
    await mkdir(join(dir, "przeglad"));
    await copyFile(new URL("../site/sitemap.xml", import.meta.url), join(dir, "sitemap.xml"));
    await copyFile(new URL("../astro/dist/przeglad/sitemap.xml", import.meta.url), join(dir, "przeglad/sitemap.xml"));
    await writeSitemap(pathToFileURL(dir + "/"));

    const root = sitemapEntries(await readFile(join(dir, "sitemap.xml"), "utf8"));
    const digests = sitemapEntries(await readFile(join(dir, "przeglad/sitemap.xml"), "utf8"));
    const urls = new Set(root.map(({ url }) => url));
    assert.equal(urls.size, root.length);
    assert.ok(urls.has("https://bartek.lol/"));
    for (const service of ["codebench", "docbench", "streambench", "weather", "shitpost"]) {
      assert.ok(urls.has(`https://${service}.bartek.lol/`));
    }
    assert.ok(urls.has("https://shitpost.bartek.lol/archive"));
    assert.deepEqual(root.filter(({ url }) => url.startsWith("https://bartek.lol/przeglad/") &&
      url !== "https://bartek.lol/przeglad/"), digests);

    await writeFile(join(dir, "przeglad/sitemap.xml"), "<urlset></urlset>");
    await writeSitemap(pathToFileURL(dir + "/"));
    const rebuilt = sitemapEntries(await readFile(join(dir, "sitemap.xml"), "utf8"));
    assert.deepEqual(rebuilt, root.filter(entry => !digests.some(digest => digest.url === entry.url)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("combined XML preserves URL escaping and published digest dates", () => {
  const loc = "<loc>https://bartek.lol/przeglad/2026-11-01/?a=1&amp;b=2</loc>";
  const first = `<urlset><url>${loc}</url></urlset>`;
  const second = `<urlset><url>${loc}<lastmod>2026-11-01</lastmod></url></urlset>`;
  const combined = combineSitemaps(first, second);
  assert.ok(combined.includes(loc));
  assert.deepEqual(sitemapEntries(combined), [{
    url: "https://bartek.lol/przeglad/2026-11-01/?a=1&b=2",
    lastmod: "2026-11-01",
  }]);
  const foreign = first.replace("bartek.lol", "example.bartek.lol.evil.example");
  assert.throws(() => combineSitemaps(foreign, second), /Foreign sitemap URL/);
});
