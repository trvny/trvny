import assert from "node:assert/strict";
import test from "node:test";

import { inlineResultContent } from "../src/inline-content.ts";
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

test("supports Polish and English translate, explain, reply and code aliases", () => {
  const parse = inlineModule.parseInlineMode;
  assert.ok(parse, "inline mode parser should exist");
  assert.deepEqual(parse("tłumacz: Good morning"), { mode: "translate", prompt: "Good morning" });
  assert.deepEqual(parse("translate: Dzień dobry"), { mode: "translate", prompt: "Dzień dobry" });
  assert.deepEqual(parse("wyjaśnij: mutex"), { mode: "explain", prompt: "mutex" });
  assert.deepEqual(parse("explain: mutex"), { mode: "explain", prompt: "mutex" });
  assert.deepEqual(parse("odpisz: dzięki za info"), { mode: "reply", prompt: "dzięki za info" });
  assert.deepEqual(parse("reply: thanks for the update"), { mode: "reply", prompt: "thanks for the update" });
  assert.deepEqual(parse("kod: fetch JSON w TypeScript"), { mode: "code", prompt: "fetch JSON w TypeScript" });
  assert.deepEqual(parse("CODE: debounce in JavaScript"), { mode: "code", prompt: "debounce in JavaScript" });
  assert.equal(inlineModule.inlineModeLabel("code"), "Kod");
  assert.match(inlineModule.inlineModeInstruction("code"), /directly usable code/u);
});

test("builds rich inline content with a bounded plain fallback", () => {
  const answer = "```ts\nconst answer = 42;\n```";
  const rich = inlineResultContent(answer, true, { plain: 4_096, rich: 32_768 });
  assert.deepEqual(rich, { rich_message: { markdown: answer } });

  const fallback = inlineResultContent("x".repeat(5_000), false, { plain: 4_096, rich: 32_768 });
  assert.equal(fallback.message_text.length, 4_096);
  assert.deepEqual(fallback.link_preview_options, { is_disabled: true });
});

test("keeps colons inside the inline payload and trims only the mode prefix", () => {
  const parse = inlineModule.parseInlineMode;
  assert.ok(parse, "inline mode parser should exist");
  assert.deepEqual(parse("streść: URL: https://example.com/a:b"), {
    mode: "summarize",
    prompt: "URL: https://example.com/a:b",
  });
});
