import assert from "node:assert/strict";
import test from "node:test";

import {
  FEEDSEEK_SOURCES,
  feedseekMemeReply,
  feedseekNewsReply,
  parseFeedseekRequest,
} from "../src/feedseek-briefing.ts";
import { routeOwnerCommand } from "../src/owner-command-router.ts";

const NOW = Date.parse("2026-11-05T15:00:00Z");

function item(title, source, publishedAt = "2026-11-05T13:00:00Z", props = {}) {
  return {
    id: title,
    title,
    text: title,
    text_kind: "title",
    url: "https://news.example.com/" + source + "/" + encodeURIComponent(title),
    date_published: publishedAt,
    ...props,
  };
}

function feed(key, entries, fields = {}) {
  return {
    format: "feedseek-model-feed", version: 1,
    source_key: key, title: key.toUpperCase(), items: entries, ...fields,
  };
}

function fixtureFetcher(sources, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const match = /\/([a-z0-9_-]+)\.json$/u.exec(url);
    assert.ok(match, "must only read a fixed Feedseek Model Feed URL");
    const contents = sources[match[1]];
    if (!contents) return new Response("not found", { status: 404 });
    return Response.json(contents);
  };
}

test("natural prompts and owner commands route to native Feedseek, not generic chat", async () => {
  for (const [message, kind, topic] of [
    ["/news", "news", "mix"],
    ["/news AI", "news", "ai"],
    ["/news pl", "news", "poland"],
    ["/news tech", "news", "tech"],
    ["co tam w szerokim świecie", "news", "mix"],
    ["Co tam na świecie?", "news", "world"],
    ["daj newsy", "news", "mix"],
    ["/meme", "meme", undefined],
    ["Wrzuć mema!", "meme", undefined],
  ]) {
    const parsed = parseFeedseekRequest(message);
    assert.equal(parsed?.kind, kind, message);
    if (kind === "news") assert.equal(parsed?.topic, topic, message);
    const routed = await routeOwnerCommand(message);
    assert.equal(routed.matched, true, message);
    if (routed.matched) assert.deepEqual(routed.value, parsed);
  }
  assert.deepEqual(parseFeedseekRequest("/news unknown"), { kind: "news", topic: null });
  assert.equal(parseFeedseekRequest("co tam"), undefined);
  assert.equal(parseFeedseekRequest("/newspaper"), undefined);
  assert.equal(parseFeedseekRequest("daj newsy, ale usuń wszystkie dane"), undefined);
  assert.equal(parseFeedseekRequest("/news " + "x".repeat(1000)), undefined);
  assert.deepEqual(await routeOwnerCommand("co tam"), { matched: false });
});

test("topic plans use only existing curated Feedseek source keys", () => {
  for (const keys of Object.values(FEEDSEEK_SOURCES)) {
    assert.ok(keys.length > 0 && keys.length <= 6);
    assert.equal(keys.length, new Set(keys).size);
    for (const key of keys) assert.match(key, /^[a-z0-9_-]+$/u);
  }
});

test("fresh broad-world response cites distinct sources with dates and HTTPS links", async () => {
  const calls = [];
  const data = {};
  const keys = FEEDSEEK_SOURCES.mix;
  for (const [index, key] of keys.entries()) {
    data[key] = feed(key, [
      item(key + " fresh headline", key,
        new Date(NOW - (index + 1) * 30_000).toISOString()),
      item("unpublished future", key, "2029-09-02T00:00:00Z"),
    ]);
  }
  const text = await feedseekNewsReply("mix", NOW, fixtureFetcher(data, calls));
  assert.match(text, /Feedseek · szeroki świat/u);
  assert.equal((text.match(/fresh headline/gu) || []).length, keys.length);
  assert.doesNotMatch(text, /unpublished future/u);
  assert.equal(calls.length, keys.length);
  assert.ok(calls.every(({ url }) =>
    url.startsWith("https://trvny.github.io/feedseek/")));
  assert.ok(calls.every(({ init }) => init.signal instanceof AbortSignal));
  assert.match(text, /05\.11/u);
  assert.match(text, /https:\/\/news\.example\.com\//u);
  assert.ok(text.length <= 4000);
});

test("future dates, stale items, bad URLs and cross-source duplicate titles are excluded", async () => {
  const data = {
    reuters: feed("reuters", [
      item("Future from bad feed", "reuters", "2029-09-02T00:00:00Z"),
      item("Fresh headline", "reuters", "2026-11-05T12:00:00Z"),
      item("Old headline", "reuters", "2026-09-05T12:00:00Z"),
    ]),
    euronews: feed("euronews", [
      item("Fresh headline", "euronews", "2026-11-05T14:00:00Z"),
      item("Alternative report", "euronews", "2026-11-05T10:00:00Z"),
    ]),
    pap: feed("pap", [item("Unsafe link", "pap", "2026-11-05T14:00:00Z", {
      url: "javascript:alert(1)",
    })]),
    geopolitics: feed("geopolitics", [
      item("Really old", "geopolitics", "2026-10-02T14:00:00Z"),
    ]),
  };
  const output = await feedseekNewsReply("world", NOW, fixtureFetcher(data));
  assert.match(output, /Fresh headline/u);
  assert.match(output, /Alternative report/u);
  assert.equal((output.match(/Fresh headline/gu) || []).length, 1);
  for (const bad of ["Future from bad feed", "Old headline", "Unsafe link", "Really old", "javascript:"]) {
    assert.doesNotMatch(output, new RegExp(bad, "u"));
  }
});

test("bad, oversized or absent feeds fail closed without invented news", async () => {
  const text = await feedseekNewsReply("poland", NOW, fixtureFetcher({
    pap: feed("pap", [item("invalid source", "pap")], { source_key: "other" }),
    tvp: feed("tvp", [item("very old", "tvp", "2025-01-01T01:00:00Z")]),
  }));
  assert.match(text, /brak potwierdzonych wpisów z ostatnich 72 godzin/u);
  assert.doesNotMatch(text, /invalid source|very old/u);
  assert.match(text, /feedseek\/reader/u);
  const limitFetcher = async () => new Response("{}", {
    headers: { "content-length": String(3 * 1024 * 1024) },
  });
  const empty = await feedseekNewsReply("ai", NOW, limitFetcher);
  assert.match(empty, /brak potwierdzonych wpisów/u);
  assert.match(await feedseekNewsReply(null, NOW, fixtureFetcher({})), /\/news ai/u);
});

test("meme reader uses curated, fresh links only and ignores political/unsafe tags", async () => {
  const fixture = feed("jbzd", [
    item("Political content", "jbzd", "2026-11-05T12:00:00Z", {
      url: "https://jbzd.com.pl/obr/1", tags: ["Polityka", "Memy"],
    }),
    item("Safe tagged meme", "jbzd", "2026-11-05T13:00:00Z", {
      url: "https://jbzd.com.pl/obr/2", tags: ["Humor", "Memy"],
      image: "https://i1.jbzd.com.pl/image.jpg",
    }),
    item("Wrong host", "jbzd", "2026-11-05T13:00:00Z", {
      url: "https://attacker.example.com/evil", tags: ["Memy"],
    }),
  ]);
  const result = await feedseekMemeReply(NOW, fixtureFetcher({ jbzd: fixture }));
  assert.match(result, /Safe tagged meme/u);
  assert.match(result, /https:\/\/jbzd\.com\.pl\/obr\/2/u);
  assert.doesNotMatch(result, /Political content|attacker|image\.jpg/u);
});

test("meme fallback tries other Feedseek sources, but never old or unknown entries", async () => {
  const valid = feed("memedroid", [
    item("Cats when they see a timeout", "memedroid", "2026-11-05T10:00:00Z", {
      url: "https://www.memedroid.com/memes/detail/42", tags: ["Memedroid"],
    }),
  ]);
  const picked = await feedseekMemeReply(NOW, fixtureFetcher({
    jbzd: feed("jbzd", [item("No date", "jbzd", "", { date_published: undefined })]),
    memedroid: valid,
  }));
  assert.match(picked, /Memedroid|MEMEDROID/u);
  assert.match(picked, /memedroid\.com\/memes\/detail\/42/u);
  assert.equal(await feedseekMemeReply(NOW, fixtureFetcher({
    jbzd: feed("jbzd", [item("Old joke", "jbzd", "2025-01-01T10:00:00Z", {
      url: "https://jbzd.com.pl/obr/old", tags: ["Memy"],
    })]),
  })), null);
});
