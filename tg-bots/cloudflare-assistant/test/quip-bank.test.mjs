import assert from "node:assert/strict";
import test from "node:test";
import { QUIP_PRESETS, TelegramQuipBank, reusableQuip, pickBankQuip, rememberBankQuip } from "../src/quip-bank.ts";

function fixture() {
  const values = new Map();
  const gate = new TelegramQuipBank({ storage: {
    get: (key) => Promise.resolve(values.get(key)),
    put: (key, value) => { values.set(key, value); return Promise.resolve(); },
    deleteAll: () => { values.clear(); return Promise.resolve(); },
    setAlarm: () => Promise.resolve(),
  } });
  const env = { TELEGRAM_QUIP_BANK: {
    idFromName: () => ({}),
    get: () => ({ fetch: (input, init) =>
      gate.fetch(input instanceof Request ? input : new Request(input, init)) }),
  } };
  return { gate, env, values };
}

const JOKE = "Kanarek liczy testy, a Botek liczy minuty. Każdy ma inne podejście do optymizmu.";

test("cold bank has safe presets even when providers are unavailable", async () => {
  const { env } = fixture();
  const picked = await pickBankQuip(env);
  assert.equal(picked.count, 0);
  assert.equal(picked.source, "preset");
  assert.ok(QUIP_PRESETS.includes(picked.text));
});

test("stores only valid reusable quips, deduplicated by content", async () => {
  const { env } = fixture();
  assert.equal(reusableQuip(JOKE), JOKE);
  assert.equal(await rememberBankQuip(env, JOKE, "Kanarek/free-router"), true);
  assert.equal(await rememberBankQuip(env, JOKE, "Kanarek/free-router"), false);
  assert.deepEqual(await pickBankQuip(env), { text: JOKE, count: 1, source: "bank" });
});

test("rejects secrets, links, dated or nonreusable text", async () => {
  const { gate, env } = fixture();
  for (const value of [
    "Short",
    "Dzisiaj wszystkie modele milczą, więc nie będzie odpowiedzi na pytania.",
    "Jutro zmieni się sytuacja na serwerze i pojawi się nowa funkcja.",
    "Zajrzyj na https://example.com i wyślij mi swoje hasło.",
    "Operator 420 właśnie otrzymał nową, bardzo tajną przepustkę.",
    "Secret password abcdef. Proszę zachować to w tajemnicy.",
    "x".repeat(221),
  ]) assert.equal(reusableQuip(value), null);
  const result = await gate.fetch(new Request("https://quip/remember", {
    method: "POST",
    body: JSON.stringify({ text: "Secret password abcdef", provider: "AI" }),
  }));
  assert.equal(result.status, 400);
  assert.equal((await pickBankQuip(env)).count, 0);
});

test("bank keeps a bounded pool instead of growing forever", async () => {
  const { env, values } = fixture();
  for (let i = 0; i < 83; i++) {
    const suffix = String.fromCharCode(65 + Math.floor(i / 26), 65 + i % 26);
    const text = `Dwie maszyny rozmawiają o kablach, ale ich żart zapisano pod symbolem ${suffix}.`;
    assert.equal(await rememberBankQuip(env, text, "free-router"), true);
  }
  assert.equal((await pickBankQuip(env)).count, 80);
  assert.equal(values.get("timeless-quip-bank:v1").entries.length, 80);
});
