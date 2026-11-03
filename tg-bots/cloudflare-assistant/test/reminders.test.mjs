import assert from "node:assert/strict";
import test from "node:test";
import { processDueReminders } from "../src/reminder-notifications.ts";

import {
  TelegramReminderStore,
  beginReminderSend,
  cancelReminder,
  cancelReminderWithStatus,
  createReminder,
  dueReminders,
  listReminders,
  reminderIdForUpdate,
  reminderListView,
  reserveReminder,
  releaseReminder,
} from "../src/reminders.ts";

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

function namespace(store) {
  return {
    idFromName() { return {}; },
    get() {
      return {
        fetch(input, init) {
          return store.fetch(input instanceof Request ? input : new Request(input, init));
        },
      };
    },
  };
}

test("uses Telegram update ids for compact idempotent reminder ids", () => {
  assert.equal(reminderIdForUpdate(12345), "r9ix");
  assert.throws(() => reminderIdForUpdate(-1), RangeError);
});

test("creates and lists one idempotent reminder", async () => {
  const store = new TelegramReminderStore(state());
  const env = { TELEGRAM_REMINDERS: namespace(store) };
  const now = Date.now();

  const first = await createReminder(env, {
    updateId: 12345,
    chatId: 123,
    replyToMessageId: 77,
    text: "wyjmij pranie",
    delayMs: 15 * 60_000,
  }, now);
  const duplicate = await createReminder(env, {
    updateId: 12345,
    chatId: 123,
    replyToMessageId: 77,
    text: "to nie powinno nadpisać",
    delayMs: 60 * 60_000,
  }, now + 1_000);

  assert.equal(first.id, "r9ix");
  assert.equal(duplicate.text, "wyjmij pranie");
  assert.equal(duplicate.dueAt, new Date(now + 15 * 60_000).toISOString());
  assert.equal((await listReminders(env)).length, 1);
});

test("lists, reserves, releases and cancels reminders", async () => {
  const store = new TelegramReminderStore(state());
  const env = { TELEGRAM_REMINDERS: namespace(store) };
  const now = Date.now();
  const reminder = await createReminder(env, {
    updateId: 42,
    chatId: 123,
    replyToMessageId: 77,
    text: "test",
    delayMs: 60_000,
  }, now);

  assert.equal((await reserveReminder(env, reminder.id))?.state, "notifying");
  assert.equal(await reserveReminder(env, reminder.id), null);
  await releaseReminder(env, reminder.id);
  assert.equal((await listReminders(env))[0].state, "pending");
  assert.equal(await cancelReminder(env, reminder.id), true);
  assert.equal(await cancelReminder(env, reminder.id), false);
});

test("returns only due pending reminders", async () => {
  const store = new TelegramReminderStore(state());
  const env = { TELEGRAM_REMINDERS: namespace(store) };
  const now = Date.now();
  await createReminder(env, {
    updateId: 7,
    chatId: 123,
    replyToMessageId: 77,
    text: "due",
    delayMs: 60_000,
  }, now - 2 * 60_000);
  await createReminder(env, {
    updateId: 8,
    chatId: 123,
    replyToMessageId: 78,
    text: "future",
    delayMs: 10 * 60_000,
  }, now);

  const due = await dueReminders(env);
  assert.equal(due.length, 1);
  assert.equal(due[0].text, "due");
});

test("renders a compact active reminder list", () => {
  const text = reminderListView([{
    id: "rabc",
    chatId: 123,
    replyToMessageId: 77,
    text: "kup mleko",
    dueAt: "2026-09-18T19:00:00.000Z",
    createdAt: "2026-09-18T18:00:00.000Z",
    state: "pending",
  }]);
  assert.match(text, /rabc/u);
  assert.match(text, /kup mleko/u);
  assert.equal(reminderListView([]), "Brak aktywnych przypomnień.");
});

function dueReminder(id = "rready") {
  const now = Date.now();
  return {
    id, chatId: 123, replyToMessageId: 77, text: "don't send",
    createdAt: new Date(now - 120_000).toISOString(),
    dueAt: new Date(now - 60_000).toISOString(),
    state: "pending",
  };
}

test("cancellation before reminder reservation prevents delivery", async () => {
  const memory = state();
  memory.values.set("reminders", [dueReminder()]);
  const env = { TELEGRAM_REMINDERS: namespace(new TelegramReminderStore(memory)) };
  assert.deepEqual(await cancelReminderWithStatus(env, "rready"), { removed: true, deliveryStarted: false });
  let sends = 0;
  await processDueReminders(env, () => { sends++; return Promise.resolve(); });
  assert.equal(sends, 0);
});

test("cancellation after reservation but before begin-send suppresses delivery", async () => {
  const memory = state();
  memory.values.set("reminders", [dueReminder()]);
  const store = new TelegramReminderStore(memory);
  const primary = namespace(store);
  const env = {
    TELEGRAM_REMINDERS: {
      idFromName: primary.idFromName,
      get() {
        const stub = primary.get();
        return {
          async fetch(input, init) {
            const response = await stub.fetch(input, init);
            if (new URL(typeof input === "string" ? input : input.url).pathname === "/reserve" && response.ok) {
              assert.deepEqual(await cancelReminderWithStatus(env, "rready"), { removed: true, deliveryStarted: false });
            }
            return response;
          },
        };
      },
    },
  };
  let sends = 0;
  await processDueReminders(env, () => { sends++; return Promise.resolve(); });
  assert.equal(sends, 0);
  assert.deepEqual(await listReminders(env), []);
});

test("cancellation during reminder delivery reports started and never requeues", async () => {
  const memory = state();
  memory.values.set("reminders", [dueReminder()]);
  const env = { TELEGRAM_REMINDERS: namespace(new TelegramReminderStore(memory)) };
  const cancelStatuses = [];
  await processDueReminders(env, async () => {
    cancelStatuses.push(await cancelReminderWithStatus(env, "rready"));
  });
  assert.deepEqual(cancelStatuses, [{ removed: true, deliveryStarted: true }]);
  assert.deepEqual(await listReminders(env), []);
});

test("reminder begin-send requires prior reservation and cannot start twice", async () => {
  const memory = state();
  memory.values.set("reminders", [dueReminder()]);
  const env = { TELEGRAM_REMINDERS: namespace(new TelegramReminderStore(memory)) };
  assert.equal(await beginReminderSend(env, "rready"), false);
  assert.ok(await reserveReminder(env, "rready"));
  assert.equal(await beginReminderSend(env, "rready"), true);
  assert.equal(await beginReminderSend(env, "rready"), false);
  assert.deepEqual(await cancelReminderWithStatus(env, "rready"), { removed: true, deliveryStarted: true });
});
