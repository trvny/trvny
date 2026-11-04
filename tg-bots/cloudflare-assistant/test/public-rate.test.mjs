import assert from "node:assert/strict";
import test from "node:test";
import { TelegramPublicRateGate } from "../src/public-rate.ts";

function memoryState() {
  const values = new Map();
  return { storage: {
    get: (key) => Promise.resolve(values.get(key)),
    put: (key, value) => { values.set(key, value); return Promise.resolve(); },
    deleteAll: () => { values.clear(); return Promise.resolve(); },
    setAlarm: () => Promise.resolve(),
  } };
}

function fixture() {
  const gate = new TelegramPublicRateGate(memoryState());
  return async (updateId, now) => {
    const response = await gate.fetch(new Request("https://rate/allow", {
      method: "POST", body: JSON.stringify({ updateId, now }),
    }));
    assert.equal(response.status, 200);
    return (await response.json()).allowed;
  };
}

test("public rate gate serializes per actor, suppresses bursts and resets windows", async () => {
  const send = fixture();
  assert.equal(await send(1, 0), true);
  assert.equal(await send(1, 0), true);
  assert.equal(await send(2, 10), false);
  for (let i = 2; i <= 12; i++) {
    assert.equal(await send(i, 1500 * i), true);
  }
  assert.equal(await send(13, 19000), false);
  assert.equal(await send(14, 61000), true);
});

test("accepted retries survive newer commands without consuming quota", async () => {
  const send = fixture();
  assert.equal(await send(42, 0), true);
  assert.equal(await send(43, 1_500), true);
  assert.equal(await send(42, 1_600), true);
  for (let id = 44; id <= 53; id++) {
    assert.equal(await send(id, (id - 42) * 1_500), true);
  }
  // Twelve unique grants fill the window; the replay did not use a thirteenth.
  assert.equal(await send(54, 18_500), false);
  assert.equal(await send(42, 90_000), true);
  assert.equal(await send(55, 90_000), true);
});

test("public gate rejects malformed update identifiers", async () => {
  const gate = new TelegramPublicRateGate(memoryState());
  const response = await gate.fetch(new Request("https://rate/allow", {
    method: "POST", body: JSON.stringify({ updateId: -1, now: 100 }),
  }));
  assert.equal(response.status, 400);
});
