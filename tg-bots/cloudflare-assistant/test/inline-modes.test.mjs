import assert from "node:assert/strict";
import test from "node:test";

import * as inlineModule from "../src/inline-mode.ts";

test("parses focused inline modes without changing plain asks", () => {
  assert.ok(inlineModule.parseInlineMode, "inline mode parser should exist");
  assert.deepEqual(inlineModule.parseInlineMode("hej Botek"), {
    mode: "ask",
    prompt: "hej Botek",
  });
  assert.deepEqual(inlineModule.parseInlineMode("streść: bardzo długi tekst"), {
    mode: "summarize",
    prompt: "bardzo długi tekst",
  });
  assert.deepEqual(inlineModule.parseInlineMode("SUM: release notes"), {
    mode: "summarize",
    prompt: "release notes",
  });
});

test("supports Polish and English translate, explain and reply aliases", () => {
  const parse = inlineModule.parseInlineMode;
  assert.ok(parse, "inline mode parser should exist");
  assert.deepEqual(parse("tłumacz: Good morning"), { mode: "translate", prompt: "Good morning" });
  assert.deepEqual(parse("translate: Dzień dobry"), { mode: "translate", prompt: "Dzień dobry" });
  assert.deepEqual(parse("wyjaśnij: mutex"), { mode: "explain", prompt: "mutex" });
  assert.deepEqual(parse("explain: mutex"), { mode: "explain", prompt: "mutex" });
  assert.deepEqual(parse("odpisz: dzięki za info"), { mode: "reply", prompt: "dzięki za info" });
  assert.deepEqual(parse("reply: thanks for the update"), { mode: "reply", prompt: "thanks for the update" });
});

test("keeps colons inside the inline payload and trims only the mode prefix", () => {
  const parse = inlineModule.parseInlineMode;
  assert.ok(parse, "inline mode parser should exist");
  assert.deepEqual(parse("streść: URL: https://example.com/a:b"), {
    mode: "summarize",
    prompt: "URL: https://example.com/a:b",
  });
});
