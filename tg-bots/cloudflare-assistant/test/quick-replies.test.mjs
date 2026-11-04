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
});

test("public quips need no provider or model when the bank is empty", async () => {
  const bank = new TelegramQuipBank({ storage: {
    get: () => Promise.resolve(undefined),
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
    KANAREK_COMPANION: { fetch: () => { throw Error("unexpected provider call"); } },
  };
  assert.ok(QUIP_PRESETS.includes(await quickQuip(env, false)));
});
