import assert from "node:assert/strict";
import test from "node:test";
import { computeTimings } from "../control-plane/task-timings.js";

test("timings split a finished task into queue wait and run time", () => {
  assert.deepEqual(
    computeTimings("2026-10-13T16:15:28.212Z", "2026-10-13T16:15:50.000Z", "2026-10-13T16:16:04.302Z"),
    { queuedMs: 21_788, runMs: 14_302, totalMs: 36_090 },
  );
});

test("timings are absent without a recorded first lease or with unparsable dates", () => {
  assert.equal(computeTimings("2026-10-13T16:15:28.212Z", undefined, "2026-10-13T16:16:04.302Z"), undefined);
  assert.equal(computeTimings("not a date", "2026-10-13T16:15:50.000Z", "2026-10-13T16:16:04.302Z"), undefined);
});

test("timings never go negative when clocks disagree", () => {
  const timings = computeTimings("2026-10-13T16:00:10.000Z", "2026-10-13T16:00:00.000Z", "2026-10-13T15:59:00.000Z");
  assert.deepEqual(timings, { queuedMs: 0, runMs: 0, totalMs: 0 });
});
