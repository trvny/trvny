import assert from "node:assert/strict";
import test from "node:test";

import { LEGION_STATUS_TIMEOUT_TEXT, isLegionRefreshCallback, legionStatusKeyboard, legionStatusView } from "../src/legion-status.ts";

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

test("shows a graceful timeout message when the task never completes", () => {
  const view = legionStatusView({ taskId: "123e4567-e89b-12d3-a456-426614174000", status: "queued" });
  assert.match(view.plain, new RegExp(LEGION_STATUS_TIMEOUT_TEXT));
});

test("surfaces the dispatcher error text on a failed task", () => {
  const view = legionStatusView({
    taskId: "123e4567-e89b-12d3-a456-426614174000",
    status: "failed",
    result: { error: "unknown direct tool" },
  });
  assert.match(view.plain, /unknown direct tool/u);
});

test("keyboard and callback matcher agree on the refresh action", () => {
  const keyboard = legionStatusKeyboard();
  assert.equal(keyboard.inline_keyboard[0][0].callback_data, "legion:refresh");
  assert.equal(isLegionRefreshCallback("legion:refresh"), true);
  assert.equal(isLegionRefreshCallback("status:refresh"), false);
  assert.equal(isLegionRefreshCallback(undefined), false);
});
