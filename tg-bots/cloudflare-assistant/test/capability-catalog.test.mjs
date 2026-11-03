import assert from "node:assert/strict";
import test from "node:test";

import { BOTEK_COMMANDS, botCommandPayload } from "../src/commands.ts";
import {
  BOTEK_CAPABILITIES,
  capabilityById,
  capabilityCommands,
  toolDeckSelection,
  toolDeckView,
} from "../src/capability-catalog.ts";

test("catalog maps each registered command to exactly one implemented capability", () => {
  const ids = BOTEK_CAPABILITIES.flatMap((capability) => {
    assert.ok(/^[a-z]{2,20}$/u.test(capability.id));
    assert.ok(capability.commands.length);
    assert.ok(capability.surfaces.includes("chat"));
    return capabilityCommands(capability).map((command) => command.command);
  });
  assert.equal(ids.length, new Set(ids).size);
  assert.deepEqual(new Set(ids), new Set(BOTEK_COMMANDS.map((command) => command.command)));
  assert.equal(BOTEK_CAPABILITIES.length, 6);
});

test("tool deck shows existing commands with safe rich markup and bounded callbacks", () => {
  const overview = toolDeckView();
  assert.match(overview.plain, /Narzędzia Botka/u);
  assert.match(overview.richHtml, /<b>Narzędzia Botka<\/b>/u);
  assert.equal(overview.keyboard.inline_keyboard.flat().length, BOTEK_CAPABILITIES.length);
  for (const button of overview.keyboard.inline_keyboard.flat()) {
    assert.ok(button.callback_data.length <= 64);
    assert.ok(capabilityById(toolDeckSelection(button.callback_data)));
  }
  const telegram = toolDeckView("telegram");
  assert.match(telegram.plain, /\/poll/u);
  assert.match(telegram.richHtml, /&lt;pytanie&gt;|&lt;nazwa&gt;|&lt;tekst&gt;/u);
  assert.equal(telegram.keyboard.inline_keyboard[0][0].callback_data, "tools:list");
  assert.ok(toolDeckView("unregistered").plain.startsWith("Nieznane narzędzie"));
});

test("only whitelisted callback identities navigate the deck", () => {
  assert.equal(toolDeckSelection("tools:list"), "");
  assert.equal(toolDeckSelection("tools:open:machine"), "machine");
  for (const input of [
    "tools:open:missing", "tools:open:machine:delete", "tools:open:../memory",
    "tasks:refresh", "tools:list:again", "tools:open:", null, 123,
  ]) assert.ok(toolDeckSelection(input) === undefined);
  assert.ok(botCommandPayload().some((entry) => entry.command === "tools"));
});
