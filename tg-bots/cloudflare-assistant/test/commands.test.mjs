import assert from "node:assert/strict";
import test from "node:test";

import { botGroupCommandPayload, parseAskCommand, parseWhisperCommand } from "../src/commands.ts";

test("parses explicit ask commands for private and group chats", () => {
  assert.equal(parseAskCommand("/ask"), "");
  assert.equal(parseAskCommand("/ask   Jak działa ten kod?  "), "Jak działa ten kod?");
  assert.equal(parseAskCommand("/ask@trvny_bot hej"), "hej");
  assert.equal(parseAskCommand("/ASK@TRVNY_BOT Hej"), "Hej");
});

test("rejects unrelated or malformed ask commands", () => {
  assert.equal(parseAskCommand("hej"), null);
  assert.equal(parseAskCommand("/asking coś"), null);
  assert.equal(parseAskCommand("/ask@x coś"), null);
  assert.equal(parseAskCommand("/ask@bad-name coś"), null);
});

test("keeps command-looking prompt text as ask payload", () => {
  assert.equal(parseAskCommand("/ask /reset"), "/reset");
  assert.equal(parseAskCommand("/ask /task trvny/trvny test"), "/task trvny/trvny test");
});


test("marks the owner group whisper command as ephemeral", () => {
  assert.deepEqual(botGroupCommandPayload(), [
    { command: "ask", description: "Zapytaj Botka jawnie, także w grupie" },
    { command: "whisper", description: "Zapytaj prywatnie w grupie", is_ephemeral: true },
  ]);
  assert.equal(parseWhisperCommand("/whisper sekret"), "sekret");
  assert.equal(parseWhisperCommand("/whisper@trvny_bot sekret"), "sekret");
  assert.equal(parseWhisperCommand("/whisper"), "");
  assert.equal(parseWhisperCommand("/ask nie whisper"), null);
});
