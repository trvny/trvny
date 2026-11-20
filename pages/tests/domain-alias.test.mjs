import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/_middleware.js";

test("custom domain aliases redirect to the durable hub", async () => {
  for (const origin of ["https://travny.pages.dev", "https://trfny.com", "https://www.trfny.com", "http://trfny.com", "https://www.bartek.lol"]) {
    for (const [path, target] of [
      ["/", "https://bartek.lol/"],
      ["/index.html", "https://bartek.lol/index.html"],
      ["/robots.txt", "https://bartek.lol/robots.txt"],
      ["/sitemap.xml", "https://bartek.lol/sitemap.xml"],
      ["/tv/?channel=tvp1", "https://bartek.lol/tv/?channel=tvp1"],
      ["/llms.txt", "https://bartek.lol/llms.txt"],
      ["//example.com/path", "https://bartek.lol//example.com/path"],
    ]) {
      for (const method of ["GET", "HEAD"]) {
        const result = await onRequest({
          request: new Request(origin + path, { method }),
          next: () => { throw new Error("alias must not read hub assets"); },
        });
        assert.equal(result.status, 301);
        assert.equal(result.headers.get("location"), target);
      }
    }
  }
});

test("stable hub and preview hosts stay outside alias routing", async () => {
  for (const host of ["bartek.lol", "preview.travny.pages.dev"]) {
    const result = await onRequest({
      request: new Request(`https://${host}/sitemap.xml`),
      next: async () => new Response("hub sitemap", { headers: { "content-type": "application/xml" } }),
    });
    assert.equal(await result.text(), "hub sitemap");
    assert.equal(result.headers.get("x-robots-tag"), host.startsWith("preview.") ? "noindex, follow" : null);
  }
});

test("legacy Pages API clients still receive the original response", async () => {
  const original = Response.json({ title: "Example" }, {
    headers: { "access-control-allow-origin": "https://tg-assistant.travny.workers.dev" },
  });
  const result = await onRequest({
    request: new Request("https://travny.pages.dev/api/radio-now"),
    next: async () => original,
  });
  assert.equal(result, original);
});


test("only the original trfny.com short links route to Feedseek", async () => {
  for (const host of ["trfny.com", "www.trfny.com"]) {
    const result = await onRequest({
      request: new Request(`https://${host}/f/example.xml?q=a%26b`),
      next: () => { throw new Error("alias must redirect"); },
    });
    assert.equal(result.headers.get("location"), "https://trvny.github.io/feedseek/example.xml?q=a%26b");
  }
  for (const path of ["/feeds", "/feeds/reader/", "/f/example.xml"]) {
    const original = new Response("Not found", { status: 404 });
    const result = await onRequest({
      request: new Request("https://bartek.lol" + path),
      next: async () => original,
    });
    assert.equal(result, original);
  }
});
