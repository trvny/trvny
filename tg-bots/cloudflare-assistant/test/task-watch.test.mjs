import assert from "node:assert/strict";
import test from "node:test";

import { TelegramTaskWatch, pendingTaskWatches, watchTask } from "../src/task-watch.ts";

const TASK_ID = "123e4567-e89b-12d3-a456-426614174000";

function state() {
  const values = new Map();
  return {
    values,
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
      async deleteAll() { values.clear(); },
      async setAlarm() {},
    },
  };
}

function namespace(taskWatch) {
  return {
    idFromName() { return {}; },
    get() {
      return {
        fetch(input, init) {
          return taskWatch.fetch(input instanceof Request ? input : new Request(input, init));
        },
      };
    },
  };
}

function watchPayload(overrides = {}) {
  return {
    taskId: TASK_ID,
    chatId: 123,
    replyToMessageId: 77,
    repo: "trvny",
    goal: "napraw test",
    createdAt: new Date().toISOString(),
    state: "pending",
    ...overrides,
  };
}

async function post(taskWatch, path, payload) {
  return taskWatch.fetch(new Request(`https://task-watch${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }));
}

test("stores, reserves, releases and finishes a task watch", async () => {
  const durable = state();
  const watches = new TelegramTaskWatch(durable);

  assert.equal((await post(watches, "/watch", watchPayload())).status, 201);
  let pending = await (await watches.fetch(new Request("https://task-watch/pending"))).json();
  assert.equal(pending.length, 1);

  const reserved = await (await post(watches, "/reserve", { taskId: TASK_ID })).json();
  assert.equal(reserved.reserved, true);
  pending = await (await watches.fetch(new Request("https://task-watch/pending"))).json();
  assert.equal(pending.length, 0);

  assert.equal((await post(watches, "/release", { taskId: TASK_ID })).status, 200);
  pending = await (await watches.fetch(new Request("https://task-watch/pending"))).json();
  assert.equal(pending.length, 1);

  assert.equal((await post(watches, "/finish", { taskId: TASK_ID })).status, 200);
  pending = await (await watches.fetch(new Request("https://task-watch/pending"))).json();
  assert.equal(pending.length, 0);
});

test("prunes stale watches instead of notifying ancient tasks", async () => {
  const durable = state();
  const watches = new TelegramTaskWatch(durable);
  const old = new Date(Date.now() - 25 * 60 * 60 * 1_000).toISOString();
  await post(watches, "/watch", watchPayload({ createdAt: old }));

  const pending = await (await watches.fetch(new Request("https://task-watch/pending"))).json();
  assert.deepEqual(pending, []);
});

test("helper registers a bounded pending watch through the namespace", async () => {
  const durable = state();
  const watches = new TelegramTaskWatch(durable);
  const env = { TELEGRAM_TASK_WATCH: namespace(watches) };

  await watchTask(env, {
    taskId: TASK_ID,
    chatId: 123,
    replyToMessageId: 77,
    repo: "trvny",
    goal: "x".repeat(3_000),
  });

  const pending = await pendingTaskWatches(env);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].goal.length, 2_000);
  assert.equal(pending[0].state, "pending");
});

test("rejects malformed watch payloads", async () => {
  const watches = new TelegramTaskWatch(state());
  const response = await post(watches, "/watch", { taskId: "nope" });
  assert.equal(response.status, 400);
});
