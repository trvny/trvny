import assert from "node:assert/strict";
import { win32 } from "node:path";
import test from "node:test";
import { localRuntimePaths, migrateDispatcherConfig } from "../src/local-runtime.js";

test("local runtime layout keeps control state outside disposable workspaces", () => {
  const root = String.raw`C:\Users\travn\.local\share\pet-dispatcher`;
  const paths = localRuntimePaths(root, win32);
  assert.equal(paths.configPath, win32.join(root, "config", "dispatcher.json"));
  assert.equal(paths.journalPath, win32.join(root, "state", "remote-journal.json"));
  assert.equal(paths.repoMirror, win32.join(root, "repos", "trvny.git"));
  assert.equal(paths.currentManifest, win32.join(root, "app", "current.json"));
  assert.equal(paths.secretsRoot, win32.join(root, "secrets"));
  assert.equal(paths.logsRoot, win32.join(root, "logs"));
});

test("legacy dispatcher config migrates control state and repository seed only", () => {
  const installRoot = String.raw`C:\Users\travn\.local\share\pet-dispatcher`;
  const dcRoot = String.raw`C:\Users\travn\dir\.dc`;
  const paths = localRuntimePaths(installRoot, win32);
  const legacy = {
    workspaceRoot: win32.join(dcRoot, "pet-dispatcher-workspace"),
    repositories: { trvny: win32.join(dcRoot, "git", "trvny-main") },
    workspaces: { dc: dcRoot },
    toolRoots: [String.raw`C:\Program Files\nodejs`],
    networkProfiles: {},
    environmentPolicyPath: String.raw`C:\custom\environment-policy.json`,
    resourceLimits: { defaultMemoryMiB: 2048, maxMemoryMiB: 6144, defaultProcessCount: 32, maxProcessCount: 64, watchdogIntervalMs: 250 },
    remote: { enabled: true, deviceId: "legion", journalPath: win32.join(dcRoot, "pet-dispatcher", "remote-journal.json") },
  };
  const migrated = migrateDispatcherConfig(legacy, {
    paths, dcRoot, workspaceRoot: win32.join(dcRoot, "pet-dispatcher-workspace"), pathApi: win32,
  });
  assert.equal(migrated.workspaceRoot, win32.join(dcRoot, "pet-dispatcher-workspace"));
  assert.deepEqual(migrated.repositories, { trvny: paths.repoMirror });
  assert.deepEqual(migrated.workspaces, { dc: dcRoot });
  assert.deepEqual(migrated.toolRoots, legacy.toolRoots);
  assert.deepEqual(migrated.resourceLimits, legacy.resourceLimits);
  assert.equal(migrated.environmentPolicyPath, legacy.environmentPolicyPath);
  assert.equal((migrated.remote as { journalPath: string }).journalPath, paths.journalPath);
});

test("config migration fails closed when the legacy shape is not an object", () => {
  const paths = localRuntimePaths(String.raw`C:\runtime`, win32);
  assert.throws(() => migrateDispatcherConfig(null, {
    paths, dcRoot: String.raw`C:\dc`, workspaceRoot: String.raw`C:\dc\sessions`, pathApi: win32,
  }), /object/i);
});
