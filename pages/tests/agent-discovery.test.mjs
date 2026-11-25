import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pageShellHead } from "../functions/_shared/page-shell.js";
import { staticHeaders } from "../scripts/build-static-shell.mjs";
import { onRequest } from "../functions/_middleware.js";

test("ARD manifest advertises real, well-formed public capability URLs", async () => {
  const catalog = JSON.parse(await readFile(new URL("../site/.well-known/ard.json", import.meta.url), "utf8"));
  assert.equal(catalog.specVersion, "0.9");
  assert.equal(catalog.host.identifier, "bartek.lol");
  assert.ok(catalog.entries.length >= 9);
  const ids = new Set();
  for (const entry of catalog.entries) {
    assert.match(entry.identifier, /^urn:air:bartek\.lol:/);
    assert.ok(!ids.has(entry.identifier), entry.identifier);
    ids.add(entry.identifier);
    assert.match(entry.type, /^[a-z]+\/[a-z0-9.+-]+$/);
    const url = new URL(entry.url);
    assert.equal(url.protocol, "https:");
    assert.ok(url.hostname.includes("."), entry.url);
    assert.ok(url.pathname.length > 1, entry.url);
    assert.ok(!("data" in entry), "one delivery method per entry");
    assert.ok(Array.isArray(entry.representativeQueries), entry.identifier);
    assert.ok(entry.representativeQueries.length >= 2, entry.identifier);
    assert.ok(entry.representativeQueries.every(q => typeof q === "string" && q.trim().length > 5));
  }
  assert.ok(catalog.entries.some(e => e.url === "https://bartek.lol/teksty/feed.xml" && e.type === "application/atom+xml"));
  assert.ok(catalog.entries.some(e => e.url === "https://bartek.lol/tv/playlist.m3u" && e.type === "application/x-mpegurl"));
  const build = await readFile(new URL("../build.sh", import.meta.url), "utf8");
  assert.match(build, /^cp site\/\.well-known\/ard\.json site\/\.well-known\/ai-catalog\.json$/m);
  const guide = await readFile(new URL("../site/llms.txt", import.meta.url), "utf8");
  assert.match(guide, /\.well-known\/ard\.json/);
  assert.match(pageShellHead("/", "home"), /rel="ard"[^>]+href="\/\.well-known\/ard\.json"/);
  const headers = staticHeaders();
  assert.match(headers, /\/teksty\/githubowa-kraina\/atlas\.json\n  Content-Type: application\/json; charset=utf-8\n  Access-Control-Allow-Origin: \*/);
  assert.match(headers, /\/\.well-known\/ard\.json\n  Content-Type: application\/ard\+json/);
  assert.match(headers, /\/\.well-known\/ai-catalog\.json\n  Content-Type: application\/ai-catalog\+json/);
});

test("Pages Functions returns real discovery content types, CORS and HEAD", async () => {
  for (const [path, mediaType] of [
    ["/.well-known/ard.json", "application/ard+json"],
    ["/.well-known/ai-catalog.json", "application/ai-catalog+json"],
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await onRequest({
        request: new Request("https://bartek.lol" + path, { method }),
        next: async () => Response.json({ catalog: true }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), mediaType + "; charset=utf-8");
      assert.equal(response.headers.get("access-control-allow-origin"), "*");
      assert.equal(await response.text(), method === "HEAD" ? "" : '{"catalog":true}');
    }
  }
});
