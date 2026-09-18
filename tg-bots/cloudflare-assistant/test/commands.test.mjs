import assert from "node:assert/strict";
import test from "node:test";

import {
  botGroupCommandPayload,
  botHelpLines,
  botStartLines,
  parseAskCommand,
  parseRecallCommand,
  parseRememberCommand,
  parseReminderCancelCommand,
  parseReminderCommand,
  parseWatchCancelCommand,
  parseWatchCommand,
  parseWhisperCommand,
} from "../src/commands.ts";

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
  assert.equal(botHelpLines().some((line) => line.startsWith("/whisper ")), false);
});


test("lists task recovery commands in private help", () => {
  const help = botHelpLines();
  assert.equal(help.some((line) => line.startsWith("/task_status <id>")), true);
  assert.equal(help.some((line) => line.startsWith("/task_cancel <id>")), true);
});

test("keeps /start compact and points to full /help", () => {
  const start = botStartLines();
  assert.ok(start.length <= 6);
  assert.equal(start.some((line) => line.includes("/help")), true);
  assert.equal(start.some((line) => line.includes("/legion")), true);
  assert.equal(start.some((line) => line.includes("/task_status")), false);
});


test("accepts a visible group ask from a media caption", async () => {
  const commands = await import("../src/commands.ts");
  assert.ok(commands.parseAskMessageCommand, "message-level ask parser should exist");
  assert.equal(commands.parseAskMessageCommand(undefined, "/ask porównaj te screeny"), "porównaj te screeny");
  assert.equal(commands.parseAskMessageCommand("/ask tekst", "/ask podpis"), "tekst");
});


test("parses bounded relative reminder commands", () => {
  assert.deepEqual(parseReminderCommand("/remind 15m | wyjmij pranie"), {
    delayMs: 15 * 60_000,
    text: "wyjmij pranie",
  });
  assert.deepEqual(parseReminderCommand("/remind 2g | sprawdź build"), {
    delayMs: 2 * 60 * 60_000,
    text: "sprawdź build",
  });
  assert.deepEqual(parseReminderCommand("/remind 1d | coś jutro"), {
    delayMs: 24 * 60 * 60_000,
    text: "coś jutro",
  });
  assert.equal(parseReminderCommand("/remind 0m | nope"), null);
  assert.equal(parseReminderCommand("/remind 31d | nope"), null);
  assert.equal(parseReminderCommand("/remind jutro | nope"), null);
});

test("parses reminder cancellation ids", () => {
  assert.equal(parseReminderCancelCommand("/remind_cancel rabc123"), "rabc123");
  assert.equal(parseReminderCancelCommand("/REMIND_CANCEL RABC123"), "rabc123");
  assert.equal(parseReminderCancelCommand("/remind_cancel nope"), null);
});


test("parses bounded durable-memory commands", () => {
  assert.equal(parseRememberCommand("/remember lubię krótkie odpowiedzi"), "lubię krótkie odpowiedzi");
  assert.equal(parseRecallCommand("/recall jak robię merge?"), "jak robię merge?");
  assert.equal(parseRememberCommand("/remember"), null);
  assert.equal(parseRecallCommand("/recall "), null);
  assert.equal(parseRememberCommand("/remember " + "x".repeat(2_001)), null);
});


test("parses proactive watch commands", () => {
  assert.deepEqual(parseWatchCommand("/watch legion offline"), {
    kind: "legion",
    condition: "offline",
  });
  assert.deepEqual(parseWatchCommand("/watch github trvny/trvny#709 ci-failed"), {
    kind: "github",
    repository: "trvny/trvny",
    number: 709,
    condition: "ci-failed",
  });
  assert.deepEqual(parseWatchCommand("/watch github travnie/Kanarek#12 merged"), {
    kind: "github",
    repository: "travnie/Kanarek",
    number: 12,
    condition: "merged",
  });
  assert.deepEqual(parseWatchCommand("/watch feedseek OpenAI nowe modele"), {
    kind: "feedseek",
    query: "OpenAI nowe modele",
  });
  assert.equal(parseWatchCommand("/watch github someone/else#1 merged"), null);
  assert.equal(parseWatchCommand("/watch feedseek "), null);
});

test("parses proactive watch cancellation ids", () => {
  assert.equal(parseWatchCancelCommand("/watch_cancel wabc123"), "wabc123");
  assert.equal(parseWatchCancelCommand("/WATCH_CANCEL WABC123"), "wabc123");
  assert.equal(parseWatchCancelCommand("/watch_cancel nope"), null);
});
