import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { brandResponse } from "../functions/_shared/brand-page.js";
import { onRequest } from "../functions/_middleware.js";

const response = (url, method = "GET") => brandResponse(new Request(url, { method }));
const middlewareResponse = (url, method = "GET") => onRequest({
  request: new Request(url, { method }),
  next: () => { throw new Error("brand routes must not read hub assets"); },
});

const verificationValues = (html) => [...html.matchAll(/<meta\b[^>]*>/giu)].flatMap(([tag]) => {
  const attributes = new Map([...tag.matchAll(/([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu)]
    .map(([, name, double, single, unquoted]) => [name.toLowerCase(), double ?? single ?? unquoted]));
  return attributes.get("name")?.toLowerCase() === "google-site-verification" ? [attributes.get("content")] : [];
});

test("brand homepage retains the existing Google verification values", async () => {
  for (const tag of [
    '<meta name="google-site-verification" content="token">',
    "<meta content='token' name='google-site-verification' />",
    '<META CONTENT=token NAME=google-site-verification>',
  ]) assert.deepEqual(verificationValues(tag), ["token"]);
  const hub = await readFile(new URL("../site/index.html", import.meta.url), "utf8");
  const values = verificationValues(hub);
  assert.ok(values.length > 0);
  const html = await response("https://trfny.com/").text();
  assert.deepEqual(verificationValues(html), values);
});

test("brand homepage has its own identity and direct product links", async () => {
  const result = response("https://trfny.com/");
  const html = await result.text();
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("content-language"), "en");
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/trfny\.com\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/trfny\.com\/">/);
  assert.match(html, /A browser can be a workshop/);
  assert.match(html, /href="https:\/\/travny\.pages\.dev\/">Open the hub/);
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(schema.url, "https://trfny.com/");
  assert.equal(schema["@type"], "CollectionPage");
  assert.equal(schema.mainEntity.itemListElement.length, 6);
  for (const { url } of schema.mainEntity.itemListElement) {
    assert.match(html, new RegExp(`href="${RegExp.escape(url)}"`));
    const hostname = new URL(url).hostname;
    assert.notEqual(hostname, "trfny.com");
    assert.ok(!hostname.endsWith(".trfny.com"));
  }
  assert.match(result.headers.get("content-security-policy"), /default-src 'none'/);
});

test("brand discovery includes only its canonical homepage", async () => {
  const sitemap = await middlewareResponse("https://trfny.com/sitemap.xml");
  assert.equal(sitemap.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.deepEqual([...((await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g))].map((match) => match[1]), ["https://trfny.com/"]);
  const robots = await middlewareResponse("https://trfny.com/robots.txt");
  assert.equal(await robots.text(), "User-agent: *\nAllow: /\nSitemap: https://trfny.com/sitemap.xml\n");
});

test("custom-domain aliases and old deep links redirect in one hop", async () => {
  for (const [from, to] of [
    ["https://www.trfny.com/", "https://trfny.com/"],
    ["http://trfny.com/?from=old", "https://trfny.com/?from=old"],
    ["https://www.trfny.com/index.html?from=old", "https://trfny.com/?from=old"],
    ["https://www.trfny.com/sitemap.xml", "https://trfny.com/sitemap.xml"],
    ["https://trfny.com/tv/?channel=tvp1", "https://travny.pages.dev/tv/?channel=tvp1"],
    ["https://www.trfny.com/llms.txt", "https://travny.pages.dev/llms.txt"],
    ["https://trfny.com//example.com/path", "https://travny.pages.dev//example.com/path"],
  ]) {
    const result = await middlewareResponse(from);
    assert.equal(result.status, 301, from);
    assert.equal(result.headers.get("location"), to, from);
  }
});

test("brand aliases reject unsupported methods before redirecting", async () => {
  for (const origin of ["http://trfny.com", "https://www.trfny.com"]) {
    for (const path of ["/", "/index.html", "/robots.txt", "/sitemap.xml"]) {
      const result = await middlewareResponse(origin + path, "POST");
      assert.equal(result.status, 405);
      assert.equal(result.headers.get("location"), null);
      assert.equal(result.headers.get("allow"), "GET, HEAD");
    }
  }
});

test("HEAD has GET headers without a body; unsupported methods fail", async () => {
  for (const path of ["/", "/robots.txt", "/sitemap.xml"]) {
    const get = response(`https://trfny.com${path}`);
    const head = response(`https://trfny.com${path}`, "HEAD");
    assert.equal(head.status, 200);
    assert.deepEqual([...head.headers], [...get.headers]);
    assert.equal(await head.text(), "");
    const post = response(`https://trfny.com${path}`, "POST");
    assert.equal(post.status, 405);
    assert.equal(post.headers.get("allow"), "GET, HEAD");
    assert.equal(post.headers.get("x-robots-tag"), "noindex");
  }
});

test("stable hub and preview hosts stay outside brand routing", async () => {
  for (const host of ["travny.pages.dev", "preview.travny.pages.dev"]) {
    assert.equal(response(`https://${host}/`), null);
    const result = await onRequest({
      request: new Request(`https://${host}/sitemap.xml`),
      next: async () => new Response("hub sitemap", { headers: { "content-type": "application/xml" } }),
    });
    assert.equal(await result.text(), "hub sitemap");
    assert.equal(result.headers.get("x-robots-tag"), host.startsWith("preview.") ? "noindex, follow" : null);
  }
});

test("middleware serves the brand before reading hub assets", async () => {
  const result = await onRequest({
    request: new Request("https://trfny.com/"),
    next: () => { throw new Error("brand must not fetch or rewrite the hub"); },
  });
  assert.equal(result.status, 200);
  assert.match(await result.text(), /A browser can be a workshop/);
});
