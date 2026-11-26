import test from "node:test";
import assert from "node:assert/strict";
import { crossSiteSitemap } from "../functions/_shared/cross-site-sitemap.js";
import { onRequest } from "../functions/_middleware.js";

test("retired Feedseek maps redirect to the canonical RSS host", async () => {
  for (const host of ["trfny.com", "www.trfny.com", "bartek.lol", "travny.pages.dev"]) {
    for (const method of ["GET", "HEAD"]) {
      const result = await onRequest({
        request: new Request("https://" + host + "/sitemaps/feedseek.xml?q=1", { method }),
        next: () => { throw new Error("Unexpected middleware fallback"); },
      });
      assert.equal(result.status, 301);
      assert.equal(result.headers.get("location"), "https://rss.bartek.lol/sitemap.xml?q=1");
    }
  }
});

test("retired hub maps redirect directly to the canonical sitemap", async () => {
  for (const host of ["bartek.lol", "travny.pages.dev", "trfny.com", "www.trfny.com"]) {
    const base = `https://${host}`;
    for (const path of [
      "/sitemap-index.xml", "/sitemap-cross-site.xml", "/przeglad/sitemap.xml",
      "/sitemap.txt", "/sitemap.json", "/sitemap-atom.xml", "/sitemap-rss.xml",
      "/sitemaps/travny.xml", "/sitemaps/digests.xml", "/sitemaps/codebench.xml",
      "/sitemaps/docbench.xml", "/sitemaps/streambench.xml", "/sitemaps/weather.xml",
      "/sitemaps/shitpost.xml",
    ]) {
      const result = await onRequest({
        request: new Request(base + path + "?test=1"),
        next: () => { throw new Error("Unexpected middleware fallback"); },
      });
      assert.equal(result.status, 301);
      assert.equal(result.headers.get("location"), "https://bartek.lol/sitemap.xml?test=1");
    }
  }
});

test("Pages alias sitemap redirects to canonical XML for GET and HEAD", async () => {
  for (const method of ["GET", "HEAD"]) {
    const result = await onRequest({
      request: new Request("https://travny.pages.dev/sitemap.xml?test=1", { method }),
      next: () => { throw new Error("Unexpected middleware fallback"); },
    });
    assert.equal(result.status, 301);
    assert.equal(result.headers.get("location"), "https://bartek.lol/sitemap.xml?test=1");
  }
  const url = new URL("https://bartek.lol/sitemap.xml");
  assert.equal(await crossSiteSitemap({ request: new Request(url) }, url), null);
});
