import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { onRequest } from "../functions/_middleware.js";
import { pageSeoHead } from "../functions/_shared/page-seo.js";

const root = new URL("../site/", import.meta.url);
const origin = "https://travny.pages.dev";
const articlePath = "/teksty/grass-mud-horse/";
const oldPath = "/teksty/grass-mud-horse-pl/";

test("the Grass Mud Horse catalog and sitemap expose one bilingual publication", async () => {
  const posts = JSON.parse(await readFile(new URL("teksty/posts.json", root), "utf8"));
  const entries = posts.filter((post) => post.slug.includes("grass-mud-horse"));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].slug, "grass-mud-horse");
  const sitemap = await readFile(new URL("sitemap.xml", root), "utf8");
  assert.ok(sitemap.includes(`<loc>${origin}${articlePath}</loc>`));
  assert.ok(!sitemap.includes(`<loc>${origin}${oldPath}</loc>`));
  const trail = pageSeoHead(articlePath);
  assert.match(trail, /Alpaka, krab i Wielki Harmonizator/u);
  assert.doesNotMatch(trail, /grass-mud-horse-pl/u);
});

test("the shared HTML retains both complete narratives and native radio switching", async () => {
  const html = await readFile(new URL("teksty/grass-mud-horse/index.html", root), "utf8");
  const css = await readFile(new URL("assets/grass-mud-horse.css", root), "utf8");
  assert.match(html, /<link rel="canonical" href="https:\/\/travny\.pages\.dev\/teksty\/grass-mud-horse\/">/u);
  assert.match(html, /"inLanguage":\["en","pl"\]/u);
  assert.match(html, /id="lang-en"[^>]+checked/u);
  assert.match(html, /id="lang-pl"/u);
  assert.match(html, /data-version="en"/u);
  assert.match(html, /data-version="pl"/u);
  assert.match(html, /Wyhoduj alpakę/u);
  assert.match(html, /The animal that shouldn't exist/u);
  assert.match(html, /I kto powiedział, że językoznawstwo musi być nudne/u);
  assert.match(html, /The internet, against all odds/u);
  assert.match(css, /#lang-pl:checked ~ \.language-versions/u);
  assert.match(css, /#lang-en:checked ~ \.language-versions/u);
  for (const part of ["prologue", "crab", "swearing", "scripts", "epilogue", "sources"]) {
    assert.ok(html.includes(`id="en-${part}"`));
    assert.ok(html.includes(`id="pl-${part}"`));
    assert.ok(html.includes(`href="#en-${part}"`));
    assert.ok(html.includes(`href="#pl-${part}"`));
  }
});

test("old Polish URLs permanently redirect to the single article in Polish", async () => {
  for (const method of ["GET", "HEAD"]) {
    for (const legacyPath of [oldPath, oldPath.slice(0, -1), oldPath + "index.html"]) {
      const request = new Request(origin + legacyPath + "?utm_source=bookmark", { method });
      const response = await onRequest({ request, next: () => { throw new Error("legacy path reached static assets"); } });
      assert.equal(response.status, 301);
      assert.equal(response.headers.get("location"), origin + articlePath + "?utm_source=bookmark&lang=pl");
    }
  }
});
