import test from "node:test";
import assert from "node:assert/strict";

import { getLatestShitpost, getShitposts } from "../functions/_shared/shitpost.js";
import { onRequestGet, onRequestHead } from "../functions/teksty/feed.xml.js";

const origin = "https://shitpost-reactor.travny.workers.dev";
const legacy = "https://shitpost.trfny.com";
const first = {
  id: legacy + "/posts/gh-12-34",
  url: origin + "/posts/gh-12-34",
  summary: "First post & <payload>",
  date_published: "2026-10-07T08:00:00Z",
  tags: ["text"],
};
const second = {
  id: legacy + "/posts/gh-56-78",
  url: origin + "/posts/gh-56-78",
  summary: "Newest post",
  date_published: "2026-10-09T08:00:00Z",
  tags: ["meme"],
};

function fakeFetch(items, ok = true) {
  return async () => ({
    ok,
    json: async () => ({ version: "https://jsonfeed.org/version/1.1", items }),
  });
}

function context() {
  const posts = [
    { slug: "grass-mud-horse", title: "Alpaca & crab", summary: "Slang <censored>",
      date: "2026-10", updated: "2026-10-08T12:00:00Z",
      tags: ["Chinese & internet"], lang: "en" },
  ];
  return {
    request: new Request("https://trfny.com/teksty/feed.xml"),
    env: { ASSETS: { fetch: async () => Response.json(posts) } },
  };
}

test("shitpost items are validated, de-duplicated and chronologically sorted", async () => {
  const posts = await getShitposts(fakeFetch([
    first, second, first, { ...second, url: "https://evil.test/posts/gh-56-78" },
  ]));
  assert.equal(posts.length, 2);
  assert.equal(posts[0].url, second.url);
  assert.equal(posts[1].url, first.url);
  assert.equal((await getLatestShitpost(fakeFetch([first, second]))).url, second.url);
});

test("merged Atom feed escapes source content and keeps stable original links", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch([first, second]);
  try {
    const response = await onRequestGet(context());
    const xml = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/atom\+xml/);
    assert.match(xml, /<title>Alpaca &amp; crab<\/title>/);
    assert.match(xml, /First post &amp; &lt;payload&gt;/);
    assert.match(xml, /Slang &lt;censored&gt;/);
    assert.match(xml, /<entry xml:lang="en">/);
    // Atom IDs immutable across hostname migration; links move.
    assert.ok(xml.includes("<id>https://trfny.com/teksty/</id>"));
    assert.ok(xml.includes('<link rel="self" type="application/atom+xml" href="https://travny.pages.dev/teksty/feed.xml"/>'));
    assert.ok(xml.includes("<id>https://trfny.com/teksty/grass-mud-horse/</id>"));
    assert.ok(xml.includes('<link rel="alternate" href="https://travny.pages.dev/teksty/grass-mud-horse/"/>'));
    assert.ok(!xml.includes("<id>https://travny.pages.dev/teksty"));
    assert.match(xml, /<source><id>https:\/\/shitpost\.trfny\.com\/<\/id>/);
    assert.ok(xml.includes(`<id>${first.id}</id>`));
    assert.ok(xml.includes(`<link rel="alternate" href="${first.url}"/>`));
    assert.ok(xml.indexOf(second.url) < xml.indexOf("Alpaca &amp; crab"));
    assert.ok(xml.indexOf("Alpaca &amp; crab") < xml.indexOf(first.url));
    const head = await onRequestHead(context());
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
  } finally {
    globalThis.fetch = original;
  }
});

test("Reactor rollout accepts both origins without changing old entry IDs", async () => {
  const old = { ...first, url: first.id };
  let requested;
  const posts = await getShitposts(async (url) => {
    requested = url;
    return fakeFetch([old, { ...first, date_modified: "2026-10-10T15:00:00Z" }])();
  });
  assert.equal(requested, `${origin}/feed.json`);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, first.id);
  assert.equal(posts[0].url, first.url);
  assert.equal(posts[0].updated, "2026-10-10T15:00:00.000Z");
  const fallback = await getShitposts(fakeFetch([{ ...old, id: undefined }]));
  assert.equal(fallback[0].id, first.id);
  assert.equal(fallback[0].url, first.url);
});

test("Reactor origin compatibility does not admit credentials or lookalike hosts", async () => {
  const posts = await getShitposts(fakeFetch([
    { ...first, url: "https://user:password@shitpost.trfny.com/posts/gh-12-34" },
    { ...first, url: "https://shitpost.trfny.com.evil.test/posts/gh-12-34" },
    { ...first, url: "https://shitpost-reactor.travny.workers.dev.evil.test/posts/gh-12-34" },
  ]));
  assert.deepEqual(posts, []);
});

test("articles remain available if Shitpost Reactor is unavailable", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch([], false);
  try {
    const response = await onRequestGet(context());
    const xml = await response.text();
    assert.equal(response.status, 200);
    assert.match(xml, /Alpaca &amp; crab/);
    assert.doesNotMatch(xml, /<source><id>https:\/\/shitpost/);
  } finally {
    globalThis.fetch = original;
  }
});

test("Reactor failures emit bounded signals without source data or error text", async (context) => {
  const warnings = [];
  context.mock.method(console, "warn", (...args) => warnings.push(args));
  for (const fetchImpl of [
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => ({ unexpected: "private payload" }) }),
    async () => { throw new Error("private transport details"); },
    async () => ({ ok: true, json: async () => { throw new Error("private JSON payload"); } }),
  ]) {
    assert.deepEqual(await getShitposts(fetchImpl), []);
  }
  assert.deepEqual(warnings, [
    ["shitpost_feed_unavailable", { reason: "http", status: 503 }],
    ["shitpost_feed_unavailable", { reason: "invalid_feed" }],
    ["shitpost_feed_unavailable", { reason: "request_or_json" }],
    ["shitpost_feed_unavailable", { reason: "request_or_json" }],
  ]);
});

test("newer duplicate updates win and tracking URL variants collapse", async () => {
  const stale = {
    ...first,
    url: first.url + "?utm_source=test#fragment",
    date_modified: "2026-10-07T08:00:00Z",
    summary: "Stale copy",
  };
  const edited = {
    ...first,
    date_modified: "2026-10-10T15:00:00Z",
    summary: "Edited copy",
  };
  const posts = await getShitposts(fakeFetch([stale, edited]));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, first.url);
  assert.equal(posts[0].caption, "Edited copy");
  assert.equal(posts[0].published, "2026-10-07T08:00:00.000Z");
  assert.equal(posts[0].updated, "2026-10-10T15:00:00.000Z");
});

test("Atom strips XML control characters and retains original publication dates", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fakeFetch([{
    ...first,
    summary: "Invalid \u0001 XML",
    date_modified: "2026-10-10T15:00:00Z",
    tags: ["\u0002 x"],
  }]);
  try {
    const response = await onRequestGet(context());
    const xml = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(xml, /[\u0001\u0002]/u);
    assert.match(xml, /<published>2026-10-07T08:00:00.000Z<\/published>/);
    assert.match(xml, /<updated>2026-10-10T15:00:00.000Z<\/updated>/);
  } finally {
    globalThis.fetch = original;
  }
});

test("undated Reactor entries use a stable Atom updated fallback, not a fake publish date", async () => {
  const original = globalThis.fetch;
  const undated = { ...first };
  delete undated.date_published;
  globalThis.fetch = fakeFetch([undated]);
  try {
    const response = await onRequestGet(context());
    const xml = await response.text();
    assert.equal(response.status, 200);
    assert.match(xml, /First post &amp; &lt;payload&gt;/);
    assert.match(xml, /<updated>1970-01-01T00:00:00.000Z<\/updated>/);
    assert.doesNotMatch(xml, /<published>1970-01-01/u);
  } finally {
    globalThis.fetch = original;
  }
});
