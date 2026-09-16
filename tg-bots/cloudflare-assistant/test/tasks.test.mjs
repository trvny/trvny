import assert from "node:assert/strict";
import test from "node:test";

import { parseTaskControlCommand } from "../src/tasks.ts";

const TASK_ID = "123e4567-e89b-12d3-a456-426614174000";

test("parses task status and cancel recovery commands", () => {
  assert.deepEqual(parseTaskControlCommand(`/task_status ${TASK_ID}`), {
    action: "status",
    taskId: TASK_ID,
  });
  assert.deepEqual(parseTaskControlCommand(`/TASK_CANCEL ${TASK_ID.toUpperCase()}`), {
    action: "cancel",
    taskId: TASK_ID,
  });
});

test("rejects malformed task recovery commands", () => {
  assert.equal(parseTaskControlCommand("/task_status"), null);
  assert.equal(parseTaskControlCommand("/task_cancel nope"), null);
  assert.equal(parseTaskControlCommand(`/task_delete ${TASK_ID}`), null);
});
