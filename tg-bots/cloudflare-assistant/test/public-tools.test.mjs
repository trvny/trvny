import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicAction, publicReply, skillDocument, skillManifest } from "../src/public-tools.ts";

function incoming(text, type = "private", from = { id: 1234, is_bot: false }) {
  return { text, chat: { type, id: 1234 }, from, message_id: 7 };
}

test("guest humans and peer bots use explicit commands only", () => {
  assert.deepEqual(parsePublicAction(incoming("/tools")), { kind: "tools", section: "" });
  assert.deepEqual(parsePublicAction(incoming("/dice", "private", { id: 8, is_bot: true })),
    { kind: "dice", emoji: "🎲" });
  assert.deepEqual(parsePublicAction(incoming("/tools@trvny_bot telegram", "group")),
    { kind: "tools", section: "telegram" });
  assert.deepEqual(parsePublicAction(incoming("/ping@trvny_bot peer-42", "group", { id: 8, is_bot: true })),
    { kind: "ping", nonce: "peer-42" });
  assert.deepEqual(parsePublicAction(incoming("/ping peer_42", "private", { id: 8, is_bot: true })),
    { kind: "ping", nonce: "peer_42" });
  assert.deepEqual(parsePublicAction(incoming("/ping")), { kind: "ping", nonce: "" });
  assert.deepEqual(parsePublicAction(incoming("/ping invalid:token")), { kind: "ping", nonce: null });
  assert.deepEqual(parsePublicAction(incoming("/ping " + "x".repeat(33))), { kind: "ping", nonce: null });
  for (const text of ["/tools", "/tools@other_bot", "/task@trvny_bot clone"]) {
    assert.equal(parsePublicAction(incoming(text, "group")), null);
  }
  assert.equal(parsePublicAction(incoming("Chatbot says hello")), null);
  assert.equal(parsePublicAction({ ...incoming("/tools"), forward_origin: { type: "user" } }), null);
});

test("public tool discovery has no owner commands or data", () => {
  const manifest = skillManifest();
  assert.deepEqual(manifest.commands.map((command) => command.command),
    ["start", "help", "tools", "skill", "ping", "dice"]);
  assert.doesNotMatch(skillDocument(), /\/task\b|\/remember\b|\/watches\b/u);
  const reply = publicReply(incoming("/help"), { kind: "help" }, "");
  assert.match(reply.text, /\/tools/u);
  assert.doesNotMatch(reply.text, /\/task\b/u);
  assert.deepEqual(publicReply(incoming("/dice"), { kind: "dice", emoji: "⚽" }, "").dice, { emoji: "⚽" });
  const pong = publicReply(incoming("/ping peer-42"), { kind: "ping", nonce: "peer-42" }, "");
  assert.equal(pong.text, "🏓 BOTEK/1 PONG peer-42");
  assert.equal(pong.replyToMessageId, 7);
  assert.equal(publicReply(incoming("/ping"), { kind: "ping", nonce: "" }, "").text,
    "🏓 BOTEK/1 PONG");
  assert.match(publicReply(incoming("/ping ???"), { kind: "ping", nonce: null }, "").text, /Użycie:/u);
  assert.match(skillDocument(), /BOTEK\/1 PONG/u);
  assert.deepEqual(skillManifest().handshake,
    { command: "/ping <nonce>", response: "BOTEK/1 PONG <nonce>", max_nonce_length: 32 });
});
