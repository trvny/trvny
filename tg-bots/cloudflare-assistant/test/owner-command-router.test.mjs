import assert from "node:assert/strict";
import test from "node:test";

import { routeOwnerCommand } from "../src/owner-command-router.ts";

test("routes exact owner commands through typed predicates", async () => {
  assert.deepEqual(await routeOwnerCommand("/status"), {
    matched: true,
    route: "status",
    value: { kind: "status" },
  });
  assert.deepEqual(await routeOwnerCommand("/start payload"), {
    matched: true,
    route: "start-help",
    value: { kind: "start-help", start: true },
  });
  assert.deepEqual(await routeOwnerCommand("/help"), {
    matched: true,
    route: "start-help",
    value: { kind: "start-help", start: false },
  });
});

test("extracts parsed command payloads before the handler runs", async () => {
  const reminder = await routeOwnerCommand("/remind 15m | wyjmij pranie");
  assert.equal(reminder.matched, true);
  if (!reminder.matched) return;
  assert.equal(reminder.route, "reminder-create");
  assert.deepEqual(reminder.value, {
    kind: "reminder-create",
    request: { delayMs: 15 * 60_000, text: "wyjmij pranie" },
  });

  const task = await routeOwnerCommand("/task trvny/trvny odpal testy");
  assert.equal(task.matched, true);
  if (!task.matched) return;
  assert.equal(task.route, "task");
  assert.deepEqual(task.value, {
    kind: "task",
    request: { repo: "trvny/trvny", goal: "odpal testy" },
  });

  const networkTask = await routeOwnerCommand("/task trvny --net github-npm-read npm ci");
  assert.equal(networkTask.matched, true);
  if (!networkTask.matched) return;
  assert.deepEqual(networkTask.value, {
    kind: "task",
    request: { repo: "trvny", goal: "npm ci", networkProfile: "github-npm-read" },
  });
});

test("keeps malformed known commands matched instead of leaking into chat", async () => {
  assert.deepEqual(await routeOwnerCommand("/watch github nope"), {
    matched: true,
    route: "watch-create",
    value: { kind: "watch-create", request: null },
  });
  assert.deepEqual(await routeOwnerCommand("/location nowhere"), {
    matched: true,
    route: "location",
    value: { kind: "location", location: null },
  });
  assert.deepEqual(await routeOwnerCommand("/task_status nope"), {
    matched: true,
    route: "task-control",
    value: { kind: "task-control", request: null },
  });
  assert.deepEqual(await routeOwnerCommand("/task trvny --net cloudflare-api nope"), {
    matched: true,
    route: "task",
    value: { kind: "task", request: null },
  });
});

test("leaves model-backed and group ask text outside owner command routing", async () => {
  assert.deepEqual(await routeOwnerCommand("/draft napisz odpowiedź"), { matched: false });
  assert.deepEqual(await routeOwnerCommand("/ask co tam"), { matched: false });
  assert.deepEqual(await routeOwnerCommand("zwykła wiadomość"), { matched: false });
});
