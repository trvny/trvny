import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

test("hub exposes navigation and read-only discovery tools", async () => {
  const source = await readFile(new URL("../site/assets/webmcp.js", import.meta.url), "utf8");
  const tools = new Map();
  const window = new EventTarget();
  const assigned = [];
  const link = { textContent: "Feedseek", href: "https://trvny.github.io/feedseek/" };
  window.location = { assign: url => assigned.push(url) };
  runInNewContext(source, {
    document: {
      modelContext: { registerTool: (tool, options) => tools.set(tool.name, { tool, options }) },
      querySelectorAll: () => [link],
    }, window, AbortController, console,
  });
  assert.equal(tools.size, 3);
  const list = tools.get("list_travny_destinations");
  assert.equal(list.tool.annotations.readOnlyHint, true);
  assert.equal(list.tool.execute({ query: "feed" }).destinations.length, 1);
  assert.equal(list.tool.execute({ query: "missing" }).destinations.length, 0);
  assert.equal(list.tool.execute({ query: 123 }).ok, false);
  assert.equal(list.tool.execute(null).ok, false);
  link.textContent = "Feedy";
  assert.equal(list.tool.execute({ query: "feedy" }).destinations[0].label, "Feedy");
  assert.equal(assigned.length, 0);
  assert.equal(tools.get("get_travny_agent_resources").tool.execute().resources.length, 5);
  assert.equal(tools.get("open_travny_destination").tool.execute({ destination: "unknown" }).ok, false);
  assert.equal(tools.get("open_travny_destination").tool.execute({ destination: "Feedy" }).ok, true);
  assert.equal(assigned[0], "https://trvny.github.io/feedseek/");
  const cached = new Event("pagehide");
  cached.persisted = true;
  window.dispatchEvent(cached);
  assert.equal(list.options.signal.aborted, false);
  window.dispatchEvent(new Event("pagehide"));
  assert.equal(list.options.signal.aborted, true);
});
