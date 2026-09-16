import assert from "node:assert/strict";
import test from "node:test";

import { TelegramConversationMemory } from "../src/conversation.ts";
import * as secretary from "../src/secretary.ts";

const connection = {
  id: "business-1",
  user: { id: 42, first_name: "Owner" },
  user_chat_id: 4200,
  date: 1,
  rights: { can_reply: true },
  is_enabled: true,
};

function message(overrides = {}) {
  return {
    message_id: 7,
    business_connection_id: "business-1",
    chat: { id: 99, type: "private" },
    from: { id: 77, first_name: "Ada", username: "ada" },
    text: "Hej, dasz radę jutro?",
    ...overrides,
  };
}

function durableState() {
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

test("accepts only enabled owner business connections", () => {
  assert.ok(secretary.isOwnerBusinessConnection, "owner connection guard should exist");
  assert.equal(secretary.isOwnerBusinessConnection(connection, "42"), true);
  assert.equal(secretary.isOwnerBusinessConnection(connection, "77"), false);
  assert.equal(secretary.isOwnerBusinessConnection({ ...connection, is_enabled: false }, "42"), false);
});

test("builds a bounded incoming secretary draft request", () => {
  assert.ok(secretary.secretaryDraftInput, "secretary draft normalizer should exist");
  assert.deepEqual(secretary.secretaryDraftInput(message(), connection), {
    connectionId: "business-1",
    chatId: 99,
    messageId: 7,
    sender: "Ada (@ada)",
    text: "Hej, dasz radę jutro?",
  });
});

test("ignores owner and bot-sent outgoing business messages", () => {
  const normalize = secretary.secretaryDraftInput;
  assert.ok(normalize, "secretary draft normalizer should exist");
  assert.equal(normalize(message({ from: { id: 42, first_name: "Owner" } }), connection), null);
  assert.equal(normalize(message({ sender_business_bot: { id: 123, first_name: "Botek" } }), connection), null);
});

test("uses captions but ignores unsupported empty business messages", () => {
  const normalize = secretary.secretaryDraftInput;
  assert.ok(normalize, "secretary draft normalizer should exist");
  assert.equal(normalize(message({ text: undefined, caption: "Sprawdź proszę ten plik" }), connection)?.text, "Sprawdź proszę ten plik");
  assert.equal(normalize(message({ text: undefined, caption: undefined }), connection), null);
});

test("keeps the draft-only footer visible within Telegram's message limit", () => {
  assert.ok(secretary.formatSecretaryNotification, "secretary notification formatter should exist");
  const output = secretary.formatSecretaryNotification({
    sender: "Ada (@ada)",
    source: "x".repeat(2_000),
    draft: "y".repeat(5_000),
  });
  assert.ok(output.length <= 4096);
  assert.match(output, /Nic nie zostało wysłane za Ciebie\.$/u);
});

test("offers native copy only when Telegram can copy the full draft", () => {
  assert.ok(secretary.secretaryDraftKeyboard, "secretary draft keyboard should exist");
  assert.deepEqual(secretary.secretaryDraftKeyboard("Jasne, dam znać jutro."), {
    inline_keyboard: [[{
      text: "📋 Kopiuj",
      style: "success",
      copy_text: { text: "Jasne, dam znać jutro." },
    }]],
  });
  assert.equal(secretary.secretaryDraftKeyboard("x".repeat(257)), undefined);
  assert.equal(secretary.secretaryDraftKeyboard(""), undefined);
});

test("normalizes bounded secretary conversation entries", () => {
  assert.ok(secretary.secretaryContextEntry, "secretary context normalizer should exist");
  const incoming = secretary.secretaryContextEntry(message({ text: "x".repeat(900), date: 1_700_000_000 }), connection);
  assert.equal(incoming?.direction, "contact");
  assert.equal(incoming?.messageId, 7);
  assert.equal(incoming?.text.length, 600);
  assert.equal(incoming?.date, 1_700_000_000);

  const outgoing = secretary.secretaryContextEntry(message({
    from: { id: 42, first_name: "Owner" },
    text: "Jasne, dam znać.",
  }), connection);
  assert.equal(outgoing?.direction, "owner");
  assert.equal(outgoing?.text, "Jasne, dam znać.");
});

test("keeps six deduplicated secretary context entries outside chat history", async () => {
  const state = durableState();
  const memory = new TelegramConversationMemory(state);
  for (let index = 1; index <= 7; index += 1) {
    const response = await memory.fetch(new Request("https://conversation/secretary-context", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messageId: index, direction: "contact", text: `m${index}`, date: index }),
    }));
    assert.equal(response.status, 201);
  }
  await memory.fetch(new Request("https://conversation/secretary-context", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId: 7, direction: "owner", text: "updated", date: 8 }),
  }));

  const context = await (await memory.fetch(new Request("https://conversation/secretary-context"))).json();
  assert.deepEqual(context.entries.map((entry) => entry.messageId), [2, 3, 4, 5, 6, 7]);
  assert.equal(context.entries.at(-1).direction, "owner");
  assert.equal(context.entries.at(-1).text, "updated");

  await memory.fetch(new Request("https://conversation/clear", { method: "POST" }));
  const afterReset = await (await memory.fetch(new Request("https://conversation/secretary-context"))).json();
  assert.deepEqual(afterReset.entries, context.entries);
  const history = await (await memory.fetch(new Request("https://conversation/history"))).json();
  assert.deepEqual(history.turns, []);
});

test("frames secretary history as bounded untrusted context", () => {
  assert.ok(secretary.secretaryContextBlock, "secretary context formatter should exist");
  const entries = Array.from({ length: 8 }, (_, index) => ({
    messageId: index + 1,
    direction: index % 2 === 0 ? "contact" : "owner",
    text: `${index}: ${"z".repeat(900)}`,
    date: 1_700_000_000 + index,
  }));
  const block = secretary.secretaryContextBlock(entries);
  assert.match(block, /UNTRUSTED Telegram Business conversation context/u);
  assert.match(block, /contact @\d+:/u);
  assert.match(block, /owner @\d+:/u);
  assert.ok(block.length <= 3_500);
  assert.doesNotMatch(block, /0: z/u, "oldest entries should fall outside the six-message window");
});
