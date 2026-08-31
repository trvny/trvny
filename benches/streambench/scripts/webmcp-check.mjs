import assert from "node:assert/strict";
import { createPlaybackAttemptCoordinator } from "../public/playback-attempt.js";

const attempts = createPlaybackAttemptCoordinator();
const first = attempts.begin();
const second = attempts.begin();
assert.equal(first.signal.aborted, true);
assert.equal(first.signal.reason, "superseded");
assert.equal(second.signal.aborted, false);
attempts.cancel("stopped");
assert.equal(second.signal.aborted, true);
assert.equal(second.signal.reason, "stopped");
const completed = attempts.begin();
attempts.complete(completed);
attempts.cancel("stopped");
assert.equal(completed.signal.aborted, false);

const tools = new Map();
globalThis.document = {
  modelContext: {
    registerTool(tool) {
      tools.set(tool.name, tool);
    },
  },
};
globalThis.window = { addEventListener() {} };
const calls = [];
globalThis.StreambenchUi = {
  readState: () => ({ status: "idle" }),
  searchEntries: (query, limit) => ({ total: 1, items: [{ index: 7, title: `edited:${query}` }], limit }),
  startPlayback: async (index) => { calls.push(["start", index]); return { ok: true, started: true }; },
  stopPlayback: () => { calls.push(["stop"]); return { ok: true }; },
};

await import(`../public/webmcp.js?check=${Date.now()}`);
assert.deepEqual([...tools.keys()].sort(), [
  "read_stream_state",
  "search_streams",
  "start_stream_playback",
  "stop_stream_playback",
].sort());
assert.deepEqual(tools.get("read_stream_state").execute(), { ok: true, status: "idle" });
const search = tools.get("search_streams").execute({ query: "name", limit: 3 });
assert.equal(search.items[0].title, "edited:name");
assert.equal((await tools.get("start_stream_playback").execute({ index: 7 })).started, true);
assert.equal(tools.get("stop_stream_playback").execute().ok, true);
assert.deepEqual(calls, [["start", 7], ["stop"]]);
assert.equal(tools.get("start_stream_playback").execute({ index: -1 }).ok, false);

delete globalThis.StreambenchUi;
delete globalThis.window;
delete globalThis.document;
console.log("WebMCP behavior checks passed");
