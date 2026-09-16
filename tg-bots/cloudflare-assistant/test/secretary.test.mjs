import assert from "node:assert/strict";
import test from "node:test";

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
