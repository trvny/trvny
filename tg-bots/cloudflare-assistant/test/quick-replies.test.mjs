import assert from "node:assert/strict";
import test from "node:test";
import { quickIntent, staticQuickReply, quickQuip } from "../src/quick-replies.ts";
import { QUIP_PRESETS, TelegramQuipBank } from "../src/quip-bank.ts";

test("matches only exact safe phrases, never arbitrary user requests", () => {
  assert.equal(quickIntent("Hej!"), "hello");
  assert.equal(quickIntent("DZIĘKI"), "thanks");
  assert.equal(quickIntent("Opowiedz dowcip"), "quip");
  assert.equal(quickIntent("Status botka?"), "status");
  for (const input of ["hej, usuń wszystkie zadania", "status Legiona", "pogoda dziś",
    "opowiedz dowcip o moim szefie", "/task przejrzyj repo"]) {
    assert.equal(quickIntent(input), null);
  }
  assert.match(staticQuickReply("hello"), /tools/u);
  assert.match(staticQuickReply("hello", "Hello!"), /Hey!/u);
  assert.match(staticQuickReply("thanks", "Thank you"), /welcome/u);
});

test("public quips need no provider or model when the bank is empty", async () => {
  let providerCalls = 0;
  const bank = new TelegramQuipBank({ storage: {
    get: () => Promise.resolve(),
    put: () => Promise.resolve(),
    deleteAll: () => Promise.resolve(),
    setAlarm: () => Promise.resolve(),
  } });
  const env = {
    TELEGRAM_QUIP_BANK: {
      idFromName: () => ({}),
      get: () => ({ fetch: (input, init) =>
        bank.fetch(input instanceof Request ? input : new Request(input, init)) }),
    },
    KANAREK_COMPANION: { fetch: () => {
      providerCalls += 1;
      throw Error("unexpected provider call");
    } },
  };
  assert.ok(QUIP_PRESETS.includes(await quickQuip(env, false)));
  assert.equal(providerCalls, 0);
});

test("failed owner generation returns retained bank text, not an error", async () => {
  const retained = "Na spotkaniu botów najwięcej mówił timeout, ale nikt nie znalazł sensownego tłumacza.";
  const bank = new TelegramQuipBank({ storage: {
    get: () => Promise.resolve({ entries: [{
      text: retained,
      provider: "free-router", createdAt: "2026-01-01T00:00:00Z",
    }] }),
    put: () => Promise.resolve(),
    deleteAll: () => Promise.resolve(),
    setAlarm: () => Promise.resolve(),
  } });
  const env = {
    TELEGRAM_QUIP_BANK: {
      idFromName: () => ({}),
      get: () => ({ fetch: (input, init) =>
        bank.fetch(input instanceof Request ? input : new Request(input, init)) }),
    },
    KANAREK_REVIEW_ROUTER_TOKEN: "test",
    KANAREK_COMPANION: { fetch: () => Promise.reject(new Error("provider unavailable")) },
    WORKERS_AI_ENABLED: "false",
  };
  const result = await quickQuip(env, true, () => true);
  assert.equal(result, retained);
});


test("owner quip outage can fall back to a recent, source-linked Feedseek meme", async (t) => {
  const bank = new TelegramQuipBank({ storage: {
    get: () => Promise.resolve(),
    put: () => Promise.resolve(),
    deleteAll: () => Promise.resolve(),
    setAlarm: () => Promise.resolve(),
  } });
  const env = {
    TELEGRAM_QUIP_BANK: {
      idFromName: () => ({}),
      get: () => ({ fetch: (input, init) =>
        bank.fetch(input instanceof Request ? input : new Request(input, init)) }),
    },
    KANAREK_REVIEW_ROUTER_TOKEN: "test",
    KANAREK_COMPANION: { fetch: () => Promise.reject(new Error("provider unavailable")) },
    WORKERS_AI_ENABLED: "false",
  };
  let feedRequests = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    feedRequests += 1;
    assert.match(String(url), /^https:\/\/raw\.githubusercontent\.com\/trvny\/feedseek\/main\/feeds\/feed_jbzd\.json$/u);
    return Response.json({
      format: "feedseek-model-feed", version: 1, source_key: "jbzd", title: "Jbzd.com.pl",
      items: [{
        id: "123", title: "A better fallback", text: "A better fallback",
        text_kind: "title", url: "https://jbzd.com.pl/obr/123",
        date_published: new Date().toISOString(), tags: ["Humor", "Memy"],
      }],
    });
  });
  const result = await quickQuip(env, true, () => true);
  assert.match(result, /Awaryjny mem z Feedseek/u);
  assert.match(result, /https:\/\/jbzd\.com\.pl\/obr\/123/u);
  assert.equal(feedRequests, 1);
});
