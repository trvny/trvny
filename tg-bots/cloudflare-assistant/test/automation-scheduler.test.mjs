import assert from "node:assert/strict";
import test from "node:test";

import { TelegramAutomationScheduler, nextAutomationAt } from "../src/automation-scheduler.ts";
import { wakeAutomation } from "../src/automation-wake.ts";

function namespace(items) {
  return { idFromName: () => ({}), get: () => ({
    fetch: async () => Response.json(items),
  }) };
}

function setup() {
  const records = new Map();
  let alarm = null;
  const storage = {
    get: async (key) => records.get(key),
    put: async (key, value) => { records.set(key, value); },
    getAlarm: async () => alarm,
    setAlarm: async (at) => { alarm = at; },
  };
  const env = {
    TELEGRAM_TASK_WATCH: namespace([]),
    TELEGRAM_REMINDERS: namespace([]),
    TELEGRAM_WATCHES: namespace([]),
  };
  const scheduler = new TelegramAutomationScheduler({ storage }, env);
  env.TELEGRAM_AUTOMATION_SCHEDULER = {
    idFromName: () => ({}),
    get: () => ({ fetch: (url, init) => scheduler.fetch(new Request(url, init)) }),
  };
  return { env, scheduler, storage, clearAlarm: () => { alarm = null; } };
}

test("idle stores need no alarm", async () => {
  const { env } = setup();
  for (const kind of ["tasks", "reminders", "watches"]) {
    assert.equal(await nextAutomationAt(env, kind), null);
  }
});

test("finds earliest reminder, watch lease and task deadline", async () => {
  const { env } = setup();
  const now = Date.now();
  const at = (offset) => new Date(now + offset).toISOString();
  env.TELEGRAM_REMINDERS = namespace([
    { state: "pending", dueAt: at(60_000) },
    { state: "sending", dueAt: at(-1) },
    { state: "pending", dueAt: at(30_000) },
  ]);
  env.TELEGRAM_WATCHES = namespace([
    { status: "active", nextCheckAt: at(120_000) },
    { status: "checking", leaseUntil: at(15_000) },
    { status: "sending", nextCheckAt: at(-1) },
  ]);
  env.TELEGRAM_TASK_WATCH = namespace([{}]);
  assert.equal(await nextAutomationAt(env, "reminders", now), now + 30_000);
  assert.equal(await nextAutomationAt(env, "watches", now), now + 15_000);
  assert.equal(await nextAutomationAt(env, "tasks", now), now + 120_000);
});

test("later wake cannot postpone an existing alarm", async () => {
  const { env, storage } = setup();
  const now = Date.now();
  await wakeAutomation(env, "reminders", now + 60_000);
  await wakeAutomation(env, "reminders", now + 120_000);
  assert.equal(await storage.getAlarm(), now + 60_000);
  await wakeAutomation(env, "reminders", now + 30_000);
  assert.equal(await storage.getAlarm(), now + 30_000);
});

test("alarm re-arms future reminders and stops when store is empty", async () => {
  const { env, scheduler, storage, clearAlarm } = setup();
  const at = Date.now() + 60_000;
  env.TELEGRAM_REMINDERS = {
    idFromName: () => ({}), get: () => ({
      fetch: async (url) => Response.json(String(url).endsWith("/list")
        ? [{ state: "pending", dueAt: new Date(at).toISOString() }]
        : []),
    }),
  };
  await wakeAutomation(env, "reminders", at);
  clearAlarm();
  await scheduler.alarm();
  assert.equal(await storage.getAlarm(), at);
  clearAlarm();
  env.TELEGRAM_REMINDERS = namespace([]);
  await scheduler.alarm();
  assert.equal(await storage.getAlarm(), null);
});

test("hourly reconciliation recovers existing overdue records", async () => {
  const { env, scheduler, storage } = setup();
  env.TELEGRAM_REMINDERS = namespace([{ state: "pending", dueAt: new Date(Date.now() - 60_000).toISOString() }]);
  const response = await scheduler.fetch(new Request("https://automation-scheduler/reconcile", {
    method: "POST", body: JSON.stringify({ kind: "reminders" }),
  }));
  assert.equal(response.status, 200);
  const alarm = await storage.getAlarm();
  assert.ok(alarm !== null && alarm <= Date.now() + 1000);
});
