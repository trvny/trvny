import assert from "node:assert/strict";
import test from "node:test";

import { TelegramConversationMemory } from "../src/conversation.ts";

const feedbackModule = await import("../src/feedback.ts").catch(() => null);

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

function feedbackCallback(data, userId = 123, chatType = "private") {
  return {
    id: "callback-1",
    data,
    from: { id: userId, first_name: "Owner" },
    message: { message_id: 77, message_thread_id: 9, chat: { id: 123, type: chatType } },
  };
}
test("builds feedback buttons and accepts only owner private callbacks", () => {
  assert.ok(feedbackModule?.replyFeedbackKeyboard, "feedback keyboard helper should exist");
  assert.ok(feedbackModule?.replyFeedbackRequest, "feedback callback parser should exist");
  assert.deepEqual(feedbackModule.replyFeedbackKeyboard(), {
    inline_keyboard: [[
      { text: "👍 Pomogło", style: "success", callback_data: "feedback:up" },
      { text: "👎 Słabo", style: "danger", callback_data: "feedback:down" },
    ]],
  });
  assert.deepEqual(feedbackModule.replyFeedbackRequest(feedbackCallback("feedback:up"), "123"), {
    messageId: 77,
    messageThreadId: 9,
    rating: "up",
  });
  assert.equal(feedbackModule.replyFeedbackRequest(feedbackCallback("feedback:down", 999), "123"), null);
  assert.equal(feedbackModule.replyFeedbackRequest(feedbackCallback("feedback:up", 123, "group"), "123"), null);
  assert.equal(feedbackModule.replyFeedbackRequest(feedbackCallback("other"), "123"), null);
});

async function postFeedback(memory, messageId, rating) {
  return memory.fetch(new Request("https://conversation/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId, rating }),
  }));
}
test("stores one overwriteable rating per bot reply message", async () => {
  const durableState = state();
  const memory = new TelegramConversationMemory(durableState);

  assert.equal((await postFeedback(memory, 77, "up")).status, 201);
  assert.equal((await postFeedback(memory, 77, "down")).status, 201);

  const stored = durableState.values.get("conversation");
  assert.equal(stored.feedback.length, 1);
  assert.equal(stored.feedback[0].messageId, 77);
  assert.equal(stored.feedback[0].rating, "down");
});

test("bounds feedback history and preserves it across append and clear", async () => {
  const durableState = state();
  const memory = new TelegramConversationMemory(durableState);
  for (let messageId = 1; messageId <= 70; messageId += 1) {
    assert.equal((await postFeedback(memory, messageId, "up")).status, 201);
  }

  let stored = durableState.values.get("conversation");
  assert.equal(stored.feedback.length, 64);
  assert.deepEqual(stored.feedback.map((item) => item.messageId), Array.from({ length: 64 }, (_, i) => i + 7));
  const append = await memory.fetch(new Request("https://conversation/append", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ user: "hello", assistant: "hi", generation: 0 }),
  }));
  assert.equal(append.status, 201);
  stored = durableState.values.get("conversation");
  assert.equal(stored.feedback.length, 64);
  assert.equal(stored.turns.length, 1);

  const cleared = await memory.fetch(new Request("https://conversation/clear", { method: "POST" }));
  assert.equal(cleared.status, 200);
  stored = durableState.values.get("conversation");
  assert.equal(stored.feedback.length, 64);
  assert.equal(stored.turns.length, 0);
});
