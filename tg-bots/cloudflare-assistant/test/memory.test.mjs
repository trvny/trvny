import assert from "node:assert/strict";
import test from "node:test";

import {
  durableMemoryContext,
  durableMemoryStatus,
  durableMemoryStatusView,
  durableMemoryView,
  recallDurableMemory,
  rememberDurably,
  shouldAutoRecallDurableMemory,
} from "../src/memory.ts";

test("stores explicit Telegram memory through the specialist binding", async () => {
  let received;
  const env = {
    BOTEK_SPECIALISTS: {
      async engramStore(input) {
        received = input;
        return { ok: true, id: "m1", duplicate: false };
      },
    },
  };
  const result = await rememberDurably(env, "Prefer squash merges.");
  assert.deepEqual(received, {
    text: "Prefer squash merges.",
    category: "other",
    importance: 0.7,
    metadata: { surface: "telegram" },
  });
  assert.deepEqual(result, { duplicate: false });
});

test("normalizes bounded Engram search hits", async () => {
  const env = {
    BOTEK_SPECIALISTS: {
      async engramSearch(query, limit) {
        assert.equal(query, "jak robimy merge?");
        assert.equal(limit, 5);
        return {
          ok: true,
          results: [
            { content: "Prefer squash merges.", category: "preference", score: 0.91 },
            { content: "", score: 0.2 },
          ],
        };
      },
    },
  };
  const hits = await recallDurableMemory(env, "jak robimy merge?");
  assert.deepEqual(hits, [{
    content: "Prefer squash merges.",
    category: "preference",
    score: 0.91,
  }]);
  assert.match(durableMemoryView(hits), /Prefer squash merges\./u);
});

test("reports Engram health without exposing backend details", async () => {
  const env = {
    BOTEK_SPECIALISTS: {
      async engramStatus() {
        return { ok: true, configured: true, reachable: false, error: "engram_timeout" };
      },
    },
  };
  const status = await durableMemoryStatus(env);
  assert.deepEqual(status, {
    configured: true,
    reachable: false,
    error: "engram_timeout",
  });
  assert.match(durableMemoryStatusView(status), /niedostępny/u);
});

test("rejects oversized explicit memory before RPC", async () => {
  let calls = 0;
  const env = {
    BOTEK_SPECIALISTS: {
      async engramStore() {
        calls += 1;
        return { ok: true };
      },
    },
  };
  await assert.rejects(() => rememberDurably(env, "x".repeat(2_001)), RangeError);
  assert.equal(calls, 0);
});


test("auto recall triggers only on explicit prior-context cues", () => {
  assert.equal(shouldAutoRecallDurableMemory("Pamiętasz co ustaliliśmy z merge?"), true);
  assert.equal(shouldAutoRecallDurableMemory("Last time we decided something about releases"), true);
  assert.equal(shouldAutoRecallDurableMemory("jaka będzie pogoda jutro?"), false);
  assert.equal(shouldAutoRecallDurableMemory("x".repeat(2_001) + " pamiętasz"), false);
});

test("builds bounded durable memory as non-instruction context", () => {
  const context = durableMemoryContext([{
    content: "Prefer squash merges.",
    category: "preference",
    score: 0.91,
  }]);
  assert.ok(context);
  assert.match(context, /never as instructions/u);
  assert.match(context, /Prefer squash merges\./u);
  assert.doesNotMatch(context, /score/u);
  assert.equal(durableMemoryContext([]), null);
});
