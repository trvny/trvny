import assert from "node:assert/strict";
import test from "node:test";
import { TelegramPublicRateGate } from "../src/public-rate.ts";

function fixture() {
  const values = new Map();
  const gate = new TelegramPublicRateGate({ storage: {
    get: async (key) => values.get(key),
    put: async (key, value) => { values.set(key, value); },
    deleteAll: async () => { values.clear(); },
    setAlarm: async () => {},
  } });
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

test("public gate rejects malformed update identifiers", async () => {
  const gate = new TelegramPublicRateGate({ storage: {
    get: async () => undefined, put: async () => {},
    deleteAll: async () => {}, setAlarm: async () => {},
  } });
  const response = await gate.fetch(new Request("https://rate/allow", {
    method: "POST", body: JSON.stringify({ updateId: -1, now: 100 }),
  }));
  assert.equal(response.status, 400);
});
