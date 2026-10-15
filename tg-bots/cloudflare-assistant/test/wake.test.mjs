import assert from "node:assert/strict";
import test from "node:test";

import { routeOwnerCommand } from "../src/owner-command-router.ts";
import { delegateWakeguard } from "../src/tasks.ts";
import { parseWakeCommand, wakeKeyboard, wakeRefreshCallback, wakeView } from "../src/wake.ts";

const TASK_ID = "0e9b8c6e-4a53-4f0d-9d0e-8f6a2c1b7a11";

test("parseWakeCommand: status, off, on with m/h/bare minutes, default 120", () => {
  assert.deepEqual(parseWakeCommand("/wake"), { action: "status" });
  assert.deepEqual(parseWakeCommand("/wake status"), { action: "status" });
  assert.deepEqual(parseWakeCommand("/wake off"), { action: "off" });
  assert.deepEqual(parseWakeCommand("/wake on"), { action: "on", minutes: 120 });
  assert.deepEqual(parseWakeCommand("/wake 3h"), { action: "on", minutes: 180 });
  assert.deepEqual(parseWakeCommand("/wake 90m"), { action: "on", minutes: 90 });
  assert.deepEqual(parseWakeCommand("/wake 45"), { action: "on", minutes: 45 });
  assert.equal(parseWakeCommand("/wake@trvny_bot 12h"), null); // other commands do not take @bot suffixes either
});

test("parseWakeCommand rejects zero, over 12h, forever and garbage", () => {
  for (const bad of ["/wake 0", "/wake 13h", "/wake 721", "/wake forever", "/wake abc", "/wake -5", "/wake 1h30m"]) {
    assert.equal(parseWakeCommand(bad), null, bad);
  }
});

test("/wake is an owner command and carries the parsed request (null = usage)", async () => {
  const ok = await routeOwnerCommand("/wake 2h");
  assert.equal(ok.matched, true);
  assert.deepEqual(ok.value, { kind: "wake", request: { action: "on", minutes: 120 } });
  const bad = await routeOwnerCommand("/wake nonsense");
  assert.equal(bad.matched, true);
  assert.deepEqual(bad.value, { kind: "wake", request: null });
  assert.equal((await routeOwnerCommand("/wakeup")).matched, false);
});

test("delegateWakeguard submits a host direct task with an explicit short timeout", async () => {
  const calls = [];
  const env = { PET_DISPATCHER: { async delegate(task, key) {
    calls.push([task, key]);
    return { status: 202, body: { taskId: TASK_ID, status: "queued" } };
  } } };
  await delegateWakeguard(env, 7, { action: "on", minutes: 90 });
  await delegateWakeguard(env, 8, { action: "off" });
  const base = { target: "host", executor: "direct", profile: "inspect", capabilities: [], network: { mode: "none" }, timeoutMinutes: 2 };
  assert.deepEqual(calls[0], [{ ...base, direct: { tool: "system.wakeguard", action: "on", minutes: 90 } }, "telegram-wake:7"]);
  assert.deepEqual(calls[1], [{ ...base, direct: { tool: "system.wakeguard", action: "off" } }, "telegram-wake:8"]);
});

test("wakeView: pending, running with deadline, off, failed", () => {
  assert.match(wakeView({ taskId: TASK_ID, status: "queued" }).plain, /w kolejce/u);
  assert.match(wakeView({ taskId: TASK_ID, status: "running" }).plain, /wykonuje/u);
  const on = wakeView({
    taskId: TASK_ID, status: "completed",
    result: { data: { running: true, until: "2026-10-15T01:50:00.000Z", heartbeatAgeSeconds: 12, guards: 1 } },
  });
  assert.match(on.plain, /trzymany w gotowości do 03:50/u);
  assert.match(on.plain, /puls 12s/u);
  const off = wakeView({ taskId: TASK_ID, status: "completed", result: { data: { running: false, guards: 0 } } });
  assert.match(off.plain, /wyłączony/u);
  const failed = wakeView({ taskId: TASK_ID, status: "failed", result: { error: "powershell exploded <b>" } });
  assert.match(failed.plain, /powershell exploded/u);
  assert.equal(failed.richHtml.includes("<b>"), false);
});

test("wake refresh callback round-trips a task id and rejects anything else", () => {
  const kb = wakeKeyboard(TASK_ID);
  assert.equal(wakeRefreshCallback(kb.inline_keyboard[0][0].callback_data), TASK_ID);
  assert.equal(wakeRefreshCallback("wake:refresh:not-a-uuid"), null);
  assert.equal(wakeRefreshCallback("legion:refresh:" + TASK_ID), null);
  assert.equal(wakeRefreshCallback(undefined), null);
});
