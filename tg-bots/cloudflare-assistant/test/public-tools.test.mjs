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
  for (const text of ["/tools", "/tools@other_bot", "/task@trvny_bot clone"]) {
    assert.equal(parsePublicAction(incoming(text, "group")), null);
  }
  assert.equal(parsePublicAction(incoming("Chatbot says hello")), null);
  assert.equal(parsePublicAction({ ...incoming("/tools"), forward_origin: { type: "user" } }), null);
});

test("public tool discovery has no owner commands or data", () => {
  const manifest = skillManifest();
  assert.deepEqual(manifest.commands.map((command) => command.command),
    ["start", "help", "tools", "skill", "dice"]);
  assert.doesNotMatch(skillDocument(), /\/task\b|\/remember\b|\/watches\b/u);
  const reply = publicReply(incoming("/help"), { kind: "help" }, "");
  assert.match(reply.text, /\/tools/u);
  assert.doesNotMatch(reply.text, /\/task\b/u);
  assert.deepEqual(publicReply(incoming("/dice"), { kind: "dice", emoji: "⚽" }, "").dice, { emoji: "⚽" });
});
