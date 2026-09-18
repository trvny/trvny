import assert from "node:assert/strict";
import test from "node:test";

import { LEGION_STATUS_PENDING_TEXT, legionRefreshCallback, legionStatusKeyboard, legionStatusView } from "../src/legion-status.ts";

const TASK_ID = "123e4567-e89b-12d3-a456-426614174000";

test("renders completed Legion vitals as plain text and a safe rich table", () => {
  const view = legionStatusView({
    taskId: "123e4567-e89b-12d3-a456-426614174000",
    status: "completed",
    result: {
      data: {
        hostname: "legion<box>",
        uptimeSeconds: 90_061,
        freeMemBytes: 4 * 1_024 * 1_024 * 1_024,
        totalMemBytes: 32 * 1_024 * 1_024 * 1_024,
        activeSessions: 0,
        activeProcesses: 2,
      },
    },
  });

  assert.match(view.plain, /Legion: ✅ online/u);
  assert.match(view.plain, /Uptime: 1d 1h 1m/u);
  assert.match(view.plain, /4\.0 GB \/ 32\.0 GB/u);
  assert.match(view.richHtml, /<table>/u);
  assert.match(view.richHtml, /legion&lt;box&gt;/u);
  assert.doesNotMatch(view.richHtml, /legion<box>/u);
});

test("explains queued Legion probes can take about a minute", () => {
  const view = legionStatusView({ taskId: TASK_ID, status: "queued" });
  assert.ok(view.plain.includes(LEGION_STATUS_PENDING_TEXT));
  assert.match(view.plain, /60 s/u);
  assert.doesNotMatch(view.plain, /offline|śpi/u);
});

test("shows progress for leased, running, and cancellation states", () => {
  assert.match(legionStatusView({ taskId: TASK_ID, status: "leased" }).plain, /📥/u);
  assert.match(legionStatusView({ taskId: TASK_ID, status: "running" }).plain, /🦾/u);
  assert.match(legionStatusView({ taskId: TASK_ID, status: "cancel_requested" }).plain, /anulowanie/u);
});

test("shows a distinct message for a cancelled task", () => {
  const view = legionStatusView({ taskId: TASK_ID, status: "cancelled" });
  assert.match(view.plain, /anulowane/u);
});

test("surfaces the dispatcher error text on a failed task", () => {
  const view = legionStatusView({
    taskId: TASK_ID,
    status: "failed",
    result: { error: "unknown direct tool" },
  });
  assert.match(view.plain, /unknown direct tool/u);
});

test("keyboard embeds the task id and the callback matcher round-trips it", () => {
  const keyboard = legionStatusKeyboard(TASK_ID);
  assert.equal(keyboard.inline_keyboard[0][0].text, "🔄 Sprawdź wynik");
  assert.equal(keyboard.inline_keyboard[0][0].callback_data, `legion:refresh:${TASK_ID}`);
  assert.equal(legionRefreshCallback(`legion:refresh:${TASK_ID}`), TASK_ID);
  assert.equal(legionRefreshCallback("legion:refresh"), null);
  assert.equal(legionRefreshCallback("status:refresh"), null);
  assert.equal(legionRefreshCallback(undefined), null);
});
