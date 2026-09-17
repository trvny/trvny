import assert from "node:assert/strict";
import test from "node:test";

import { awaitLegionStatus, parseTaskControlCommand, taskView } from "../src/tasks.ts";

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

test("renders a bounded rich task report with escaped dispatcher output", () => {
  const view = taskView({
    taskId: TASK_ID,
    deviceId: "legion",
    status: "completed",
    updatedAt: "2026-09-16T10:00:00Z",
    heartbeatAt: "2026-09-16T09:59:50Z",
    result: {
      summary: "Tests passed <all>",
      output: "npm test\n52/52 & green",
      commit: "abc123",
      exportedRef: "refs/heads/feat/x",
    },
  }, "trvny/trvny", "Fix <thing> & test it");

  assert.match(view.plain, /Legion: ✅ completed/u);
  assert.match(view.plain, /Commit: abc123/u);
  assert.match(view.richHtml, /<h2>Legion task<\/h2>/u);
  assert.match(view.richHtml, /Fix &lt;thing&gt; &amp; test it/u);
  assert.match(view.richHtml, /Tests passed &lt;all&gt;/u);
  assert.match(view.richHtml, /52\/52 &amp; green/u);
  assert.doesNotMatch(view.richHtml, /Fix <thing>/u);
});

test("refetches full state when the initial response is terminal but carries no result", async () => {
  // Regression: delegate()'s response is bare {taskId, status} even on an idempotent redelivery
  // that hits an already-completed task (control-plane/entry.ts's enqueueTask early-return) - a
  // naive "terminal means done" short-circuit would render the timeout view for a real success.
  let getTaskCalls = 0;
  const env = {
    PET_DISPATCHER: {
      async getTask(taskId) {
        getTaskCalls += 1;
        assert.equal(taskId, TASK_ID);
        return {
          status: 200,
          body: { taskId: TASK_ID, status: "completed", result: { data: { hostname: "legion" } } },
        };
      },
    },
  };
  const task = await awaitLegionStatus(env, { taskId: TASK_ID, status: "completed" }, 5);
  assert.equal(getTaskCalls, 1);
  assert.equal(task.result?.data?.hostname, "legion");
});

test("skips the extra round trip when the initial response already carries a result", async () => {
  let getTaskCalls = 0;
  const env = { PET_DISPATCHER: { async getTask() { getTaskCalls += 1; } } };
  const initial = { taskId: TASK_ID, status: "completed", result: { data: { hostname: "legion" } } };
  const task = await awaitLegionStatus(env, initial, 5);
  assert.equal(getTaskCalls, 0);
  assert.equal(task, initial);
});
