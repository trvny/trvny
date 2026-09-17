import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchRecentTasks,
  isTasksRefreshCallback,
  legionRefreshPlan,
  parseTaskControlCommand,
  recentTasksKeyboard,
  recentTasksView,
  resolveLegionStatus,
  taskView,
} from "../src/tasks.ts";

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

test("resolveLegionStatus never waits - returns a non-terminal status immediately with no RPC", async () => {
  let getTaskCalls = 0;
  const env = { PET_DISPATCHER: { async getTask() { getTaskCalls += 1; } } };
  const initial = { taskId: TASK_ID, status: "queued" };
  const task = await resolveLegionStatus(env, initial);
  assert.equal(getTaskCalls, 0);
  assert.equal(task, initial);
});

test("resolveLegionStatus refetches once when a terminal response carries no result", async () => {
  // Regression: delegate()'s response is bare {taskId, status} even on an idempotent redelivery
  // that hits an already-completed task (control-plane/entry.ts's enqueueTask early-return) - a
  // naive "terminal means done" short-circuit would render a blank/pending view for a real success.
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
  const task = await resolveLegionStatus(env, { taskId: TASK_ID, status: "completed" });
  assert.equal(getTaskCalls, 1);
  assert.equal(task.result?.data?.hostname, "legion");
});

test("resolveLegionStatus skips the extra round trip when the initial response already carries a result", async () => {
  let getTaskCalls = 0;
  const env = { PET_DISPATCHER: { async getTask() { getTaskCalls += 1; } } };
  const initial = { taskId: TASK_ID, status: "completed", result: { data: { hostname: "legion" } } };
  const task = await resolveLegionStatus(env, initial);
  assert.equal(getTaskCalls, 0);
  assert.equal(task, initial);
});

test("legionRefreshPlan renders a pending task as-is and asks for no follow-up probe", () => {
  const pending = { taskId: TASK_ID, status: "queued" };
  const plan = legionRefreshPlan(pending);
  assert.equal(plan.render, pending);
  assert.equal(plan.needsNewProbe, false);
});

test("legionRefreshPlan renders a completed task and asks for a follow-up probe", () => {
  const completed = { taskId: TASK_ID, status: "completed", result: { data: { hostname: "legion" } } };
  const plan = legionRefreshPlan(completed);
  assert.equal(plan.render, completed);
  assert.equal(plan.needsNewProbe, true);
});

test("legionRefreshPlan renders a failed task and asks for a follow-up probe", () => {
  const failed = { taskId: TASK_ID, status: "failed", result: { error: "boom" } };
  const plan = legionRefreshPlan(failed);
  assert.equal(plan.render, failed);
  assert.equal(plan.needsNewProbe, true);
});

test("legionRefreshPlan renders a cancelled task and asks for a follow-up probe", () => {
  const cancelled = { taskId: TASK_ID, status: "cancelled" };
  const plan = legionRefreshPlan(cancelled);
  assert.equal(plan.render, cancelled);
  assert.equal(plan.needsNewProbe, true);
});

test("fetchRecentTasks asks the dispatcher for a bounded limit in a single call", async () => {
  let calls = 0;
  let receivedLimit;
  const env = {
    PET_DISPATCHER: {
      async recentTasks(limit) {
        calls += 1;
        receivedLimit = limit;
        return [];
      },
    },
  };
  await fetchRecentTasks(env);
  assert.equal(calls, 1);
  assert.equal(receivedLimit, 5);
});

test("recentTasksView shows an empty-state message with no tasks", () => {
  const view = recentTasksView([]);
  assert.match(view.plain, /Brak ostatnich zadań/u);
  assert.match(view.richHtml, /Brak ostatnich zadań/u);
});

test("recentTasksView renders status, short id, device and result per task", () => {
  const view = recentTasksView([
    { taskId: TASK_ID, deviceId: "legion", status: "completed", result: { summary: "Tests passed <all>" } },
    { taskId: "223e4567-e89b-12d3-a456-426614174000", status: "failed", result: { error: "boom <bad>" } },
  ]);
  assert.match(view.plain, /completed/u);
  assert.match(view.plain, /123e4567/u);
  assert.match(view.plain, /legion/u);
  assert.match(view.plain, /Tests passed <all>/u);
  assert.match(view.plain, /Błąd: boom <bad>/u);
  assert.match(view.richHtml, /<table>/u);
  assert.match(view.richHtml, /Tests passed &lt;all&gt;/u);
  assert.doesNotMatch(view.richHtml, /Tests passed <all>/u);
});

test("recentTasksKeyboard exposes a single refresh callback", () => {
  const keyboard = recentTasksKeyboard();
  assert.equal(keyboard.inline_keyboard.length, 1);
  assert.equal(keyboard.inline_keyboard[0][0].callback_data, "tasks:refresh");
});

test("isTasksRefreshCallback matches only the exact refresh token", () => {
  assert.equal(isTasksRefreshCallback("tasks:refresh"), true);
  assert.equal(isTasksRefreshCallback("tasks:refresh:extra"), false);
  assert.equal(isTasksRefreshCallback("task:refresh:" + TASK_ID), false);
  assert.equal(isTasksRefreshCallback(undefined), false);
});
