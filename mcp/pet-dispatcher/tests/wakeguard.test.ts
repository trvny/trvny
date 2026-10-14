import assert from "node:assert/strict";
import test from "node:test";
import type { DispatcherConfig } from "../src/config.js";
import { ConfinedRemoteExecutor } from "../src/remote-executor.js";
import { isHostTask, requiresOwnerRoute } from "../control-plane/host-access.js";
import { assertAssistantTaskAllowed, buildHostFsTask, remoteDirectCallSchema, remoteTaskSchema, REMOTE_DIRECT_TOOLS } from "../src/remote-protocol.js";
import { parseWakeguardState, type WakeguardAction, type WakeguardState } from "../src/wakeguard.js";

const hostTask = (direct: unknown) => ({
  target: "host", executor: "direct", profile: "inspect", capabilities: [],
  network: { mode: "none" }, timeoutMinutes: 2, direct,
});

test("system.wakeguard parses only with a bounded action and minutes on 'on'", () => {
  assert.ok(remoteDirectCallSchema.safeParse({ tool: "system.wakeguard", action: "on", minutes: 720 }).success);
  assert.ok(remoteDirectCallSchema.safeParse({ tool: "system.wakeguard", action: "off" }).success);
  assert.equal(remoteDirectCallSchema.safeParse({ tool: "system.wakeguard", action: "on", minutes: 721 }).success, false);
  assert.equal(remoteDirectCallSchema.safeParse({ tool: "system.wakeguard", action: "on", minutes: 0 }).success, false);
  assert.equal(remoteDirectCallSchema.safeParse({ tool: "system.wakeguard", action: "off", minutes: 5 }).success, false);
  assert.equal(remoteDirectCallSchema.safeParse({ tool: "system.wakeguard", action: "forever" }).success, false);
  assert.equal(remoteDirectCallSchema.safeParse({ tool: "system.wakeguard", action: "on", extra: 1 }).success, false);
});

test("system.wakeguard is host-target only and not exposed through pet_direct", () => {
  assert.ok(remoteTaskSchema.safeParse(hostTask({ tool: "system.wakeguard", action: "status" })).success);
  const withRepo = {
    repo: "legion", executor: "direct", profile: "inspect", capabilities: ["workspace.read", "git.read"],
    network: { mode: "none" }, timeoutMinutes: 2, direct: { tool: "system.wakeguard", action: "on" },
  };
  assert.equal(remoteTaskSchema.safeParse(withRepo).success, false);
  assert.equal((REMOTE_DIRECT_TOOLS as readonly string[]).includes("system.wakeguard"), false);
});

test("assistant may request wakeguard on the host target only", () => {
  const ok = remoteTaskSchema.parse(hostTask({ tool: "system.wakeguard", action: "on", minutes: 60 }));
  assert.doesNotThrow(() => assertAssistantTaskAllowed(ok));
  // A repo-scoped wakeguard task cannot even be built (schema), so the policy never sees one.
  assert.equal(remoteTaskSchema.safeParse({
    repo: "legion", executor: "direct", profile: "inspect", capabilities: ["workspace.read", "git.read"],
    network: { mode: "none" }, timeoutMinutes: 2, direct: { tool: "system.wakeguard", action: "off" },
  }).success, false);
  // The allowlist must stay closed for every other schema-valid direct tool.
  const other = remoteTaskSchema.parse({
    repo: "legion", executor: "direct", profile: "inspect", capabilities: ["workspace.read", "git.read"],
    network: { mode: "none" }, timeoutMinutes: 2, direct: { tool: "fs.read", path: "README.md" },
  });
  assert.throws(() => assertAssistantTaskAllowed(other), /assistant_task_profile_forbidden/u);
});

test("host-target tasks are classified as host tasks; only host.fs needs the owner route", () => {
  const wake = remoteTaskSchema.parse(hostTask({ tool: "system.wakeguard", action: "off" }));
  const status = remoteTaskSchema.parse(hostTask({ tool: "system.status" }));
  const hostFs = buildHostFsTask({ ops: [{ op: "stat", path: "C:\\Users" }] });
  assert.equal(isHostTask(wake), true);
  assert.equal(isHostTask(status), true);
  assert.equal(isHostTask(hostFs), true);
  assert.equal(isHostTask(remoteTaskSchema.parse({
    repo: "legion", executor: "direct", profile: "inspect", capabilities: ["workspace.read", "git.read"],
    network: { mode: "none" }, timeoutMinutes: 2, direct: { tool: "fs.read", path: "README.md" },
  })), false);
  assert.equal(requiresOwnerRoute(wake), false);
  assert.equal(requiresOwnerRoute(hostFs), true);
});

test("executor honours a cancellation that arrived before dispatch", async () => {
  let called = false;
  const executor = new ConfinedRemoteExecutor({} as DispatcherConfig, {} as never, {} as never, undefined, undefined, undefined,
    async () => { called = true; return { running: true, pid: 1, startedAt: null, until: null, heartbeatAgeSeconds: 0, guards: 1 }; });
  const controller = new AbortController();
  controller.abort();
  const result = await executor.execute(remoteTaskSchema.parse(hostTask({ tool: "system.wakeguard", action: "on" })), "w5", controller.signal);
  assert.equal(result.status, "cancelled");
  assert.equal(called, false);
});

test("executor runs system.wakeguard through the injected control; default minutes 120, none for off", async () => {
  const calls: Array<[WakeguardAction, number | undefined]> = [];
  const state: WakeguardState = { running: true, pid: 7, startedAt: "s", until: "u", heartbeatAgeSeconds: 1, guards: 1 };
  const executor = new ConfinedRemoteExecutor({} as DispatcherConfig, {} as never, {} as never, undefined, undefined, undefined,
    async (action, minutes) => { calls.push([action, minutes]); return { ...state, running: action !== "off" }; });
  const on = await executor.execute(remoteTaskSchema.parse(hostTask({ tool: "system.wakeguard", action: "on" })), "w1");
  const off = await executor.execute(remoteTaskSchema.parse(hostTask({ tool: "system.wakeguard", action: "off" })), "w2");
  assert.equal(on.status, "completed");
  assert.equal((on.data as WakeguardState).running, true);
  assert.equal((off.data as WakeguardState).running, false);
  assert.deepEqual(calls, [["on", 120], ["off", undefined]]);
});

test("executor reports a wakeguard failure instead of throwing, and a missing control", async () => {
  const broken = new ConfinedRemoteExecutor({} as DispatcherConfig, {} as never, {} as never, undefined, undefined, undefined,
    async () => { throw new Error("powershell exploded"); });
  const task = remoteTaskSchema.parse(hostTask({ tool: "system.wakeguard", action: "status" }));
  const failed = await broken.execute(task, "w3");
  assert.equal(failed.status, "failed");
  assert.match(String(failed.error), /powershell exploded/u);
  const none = await new ConfinedRemoteExecutor({} as DispatcherConfig, {} as never, {} as never).execute(task, "w4");
  assert.equal(none.status, "failed");
});

test("parseWakeguardState reads the helper's last JSON line and surfaces helper errors", () => {
  const parsed = parseWakeguardState('noise\r\n{"running":true,"pid":42,"startedAt":"a","until":"b","heartbeatAgeSeconds":3,"guards":1}\r\n');
  assert.deepEqual(parsed, { running: true, pid: 42, startedAt: "a", until: "b", heartbeatAgeSeconds: 3, guards: 1 });
  assert.deepEqual(
    parseWakeguardState('{"running":false,"pid":null,"startedAt":null,"until":null,"heartbeatAgeSeconds":null,"guards":0}'),
    { running: false, pid: null, startedAt: null, until: null, heartbeatAgeSeconds: null, guards: 0 },
  );
  assert.throws(() => parseWakeguardState('{"error":"new guard did not report in 15 s"}'), /did not report/u);
});
