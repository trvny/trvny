import test from "node:test";
import assert from "node:assert/strict";
import { crossSiteSitemap } from "../functions/_shared/cross-site-sitemap.js";
import { onRequest } from "../functions/_middleware.js";

const origin = "https://trfny.com";
const context = (path, method = "GET", env = {}) => ({
  request: new Request(origin + path, { method }), env,
  next: () => { throw new Error("Unexpected middleware fallback"); },
});
const content = '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://bartek.lol/</loc></url></urlset>';
const source = () => new Response(content, { headers: { "content-type": "application/xml" } });

test("index served directly on verified apex, GET and HEAD", async () => {
  const res = await onRequest(context("/sitemap-cross-site.xml"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /^application\/xml/);
  const body = await res.text();
  for (const name of ["travny", "digests", "feedseek"]) {
    assert.ok(body.includes(`<loc>${origin}/sitemaps/${name}.xml</loc>`));
  }
  assert.equal(await (await onRequest(context("/sitemap-cross-site.xml", "HEAD"))).text(), "");
});

test("hub maps reuse deployed assets unchanged", async () => {
  for (const [name, path] of [["travny", "/sitemap.xml"], ["digests", "/przeglad/sitemap.xml"]]) {
    const res = await onRequest(context("/sitemaps/" + name + ".xml", "GET", { ASSETS: {
      fetch: async url => { assert.equal(url, origin + path); return source(); },
    } }));
    assert.equal(await res.text(), content);
  }
});

test("Feedseek mirror has fixed upstream and preserves response", async () => {
  const ctx = context("/sitemaps/feedseek.xml?url=https://example.com/");
  const res = await crossSiteSitemap(ctx, new URL(ctx.request.url), async (url, options) => {
    assert.equal(url, "https://trvny.github.io/feedseek/sitemap.xml");
    assert.equal(options.redirect, "manual");
    return source();
  });
  assert.equal(await res.text(), content);
});

test("upstream failure stays retryable, and non-map routes fall through", async () => {
  const ctx = context("/sitemaps/feedseek.xml");
  const res = await crossSiteSitemap(ctx, new URL(ctx.request.url), async () => new Response("not xml"));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const redirect = await crossSiteSitemap(ctx, new URL(ctx.request.url), async () => Response.redirect("https://example.com/"));
  assert.equal(redirect.status, 503);
  for (const url of ["https://www.trfny.com/sitemap-cross-site.xml", "https://bartek.lol/sitemap-cross-site.xml", origin + "/sitemaps/unknown.xml"]) {
    assert.equal(await crossSiteSitemap(ctx, new URL(url)), null);
  }
  const post = context("/sitemap-cross-site.xml", "POST");
  assert.equal(await crossSiteSitemap(post, new URL(post.request.url)), null);
});
