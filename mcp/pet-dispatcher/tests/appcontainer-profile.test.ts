import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containerNameForSession, deleteSessionContainerProfile, markSessionContainer, releaseSessionContainer } from "../src/appcontainer-profile.js";

async function withSessionDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pd-ac-"));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("release does nothing for a session that never created a container (no PowerShell start)", async () => {
  await withSessionDir(async (dir) => {
    let calls = 0;
    await releaseSessionContainer(dir, "abc-123", async () => { calls += 1; });
    assert.equal(calls, 0);
  });
});

test("release deletes the profile of a session that created one", { skip: process.platform !== "win32" }, async () => {
  await withSessionDir(async (dir) => {
    await markSessionContainer(dir, "abc-123");
    const names: string[] = [];
    await releaseSessionContainer(dir, "abc-123", async (_ps, args) => { names.push(args[args.indexOf("-Name") + 1]!); });
    assert.deepEqual(names, ["pet-dispatcher-abc-123"]);
  });
});

test("release reports a leftover profile instead of failing silently", { skip: process.platform !== "win32" }, async () => {
  await withSessionDir(async (dir) => {
    await markSessionContainer(dir, "abc-123");
    await assert.rejects(releaseSessionContainer(dir, "abc-123", async () => { throw new Error("boom"); }), /leftover AppContainer profile pet-dispatcher-abc-123/);
  });
});

test("container name matches the MXC profile name used for a session", () => {
  assert.equal(containerNameForSession("abc-123"), "pet-dispatcher-abc-123");
});

test("profile cleanup runs the helper script with the session's container name", { skip: process.platform !== "win32" }, async () => {
  const calls: string[][] = [];
  const ok = await deleteSessionContainerProfile("abc-123", async (_ps, args) => { calls.push(args); });
  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  const args = calls[0]!;
  assert.ok(args.includes("-File") && args.some((a) => a.endsWith("delete-appcontainer-profile.ps1")));
  assert.equal(args[args.indexOf("-Name") + 1], "pet-dispatcher-abc-123");
});

test("profile cleanup never throws, a failing helper reports false", { skip: process.platform !== "win32" }, async () => {
  const ok = await deleteSessionContainerProfile("abc-123", async () => { throw new Error("boom"); });
  assert.equal(ok, false);
});

test("helper script refuses names outside the pet-dispatcher prefix", { skip: process.platform !== "win32" }, async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const ps = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  await assert.rejects(promisify(execFile)(ps, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "scripts/delete-appcontainer-profile.ps1", "-Name", "microsoft.windows.cortana"], { windowsHide: true }));
});
