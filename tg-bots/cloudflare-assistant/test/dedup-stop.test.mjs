import assert from "node:assert/strict";
import test from "node:test";

import { TelegramUpdateDedup } from "../src/dedup.ts";

function state() {
  const values = new Map();
  return {
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
      async setAlarm() {},
      async deleteAll() { values.clear(); },
    },
  };
}

test("durably records a generation stop request", async () => {
  const dedup = new TelegramUpdateDedup(state());
  const before = await dedup.fetch(new Request("https://dedup/stop-state"));
  assert.deepEqual(await before.json(), { requested: false });

  const stopped = await dedup.fetch(new Request("https://dedup/stop", { method: "POST" }));
  assert.equal(stopped.status, 200);
  assert.deepEqual(await stopped.json(), { requested: true });

  const after = await dedup.fetch(new Request("https://dedup/stop-state"));
  assert.deepEqual(await after.json(), { requested: true });
});
