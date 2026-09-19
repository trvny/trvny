import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { findCommandOnPath } from "../src/agent-router.js";
import type { DispatcherConfig } from "../src/config.js";
import { loadConfig } from "../src/config.js";
import { ConfinedRemoteExecutor } from "../src/remote-executor.js";
import { remoteTaskSchema, type RemoteResult } from "../src/remote-protocol.js";
import * as remoteTransport from "../src/remote-transport.js";
import { SessionManager } from "../src/sessions.js";

const execFileAsync = promisify(execFile);
const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const READ_CAPS = ["workspace.read", "git.read"] as const;
const WRITE_CAPS = ["workspace.read", "workspace.write", "git.read", "git.commit"] as const;

function dataOf<T>(result: RemoteResult): T { return result.data as T; }

async function gitFixture() {
  const base = await mkdtemp(join(tmpdir(), "pet-usability-"));
  const repo = join(base, "repo");
  await mkdir(repo);
  await execFileAsync("git", ["init", repo]);
  await writeFile(join(repo, "README.md"), "# before\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md"]);
  await execFileAsync("git", ["-C", repo, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "init"]);
  const gitWhere = await execFileAsync(process.platform === "win32" ? "where.exe" : "which", ["git"]);
  const gitRoot = dirname(gitWhere.stdout.split(/\r?\n/u)[0] ?? "");
  const config = {
    workspaceRoot: join(base, "worker"), repositories: { fixture: repo }, workspaces: {}, toolRoots: [gitRoot], networkProfiles: {},
    defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  } satisfies DispatcherConfig;
  return { base, repo, config, sessions: new SessionManager(config) };
}

function directTask(call: Record<string, unknown>, write = false) {
  return remoteTaskSchema.parse({
    repo: "fixture", baseRef: "HEAD", executor: "direct", profile: write ? "code" : "inspect",
    capabilities: write ? [...WRITE_CAPS] : [...READ_CAPS], network: { mode: "none" }, timeoutMinutes: 2, direct: call,
  });
}

test("PATH discovery returns the canonical executable behind a PATH-directory symlink", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-path-discovery-"));
  try {
    const realBin = join(root, "real-bin");
    const linkBin = join(root, "link-bin");
    await mkdir(realBin);
    const executable = join(realBin, "pet-tool");
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, 0o755);
    await symlink(realBin, linkBin, "dir");
    const found = await findCommandOnPath("pet-tool", { PATH: linkBin });
    assert.equal(found, await realpath(executable));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("direct write schema supports an explicit auto-session and one-call finish", () => {
  const auto = directTask({ tool: "fs.write", autoSession: true, path: "README.md", content: "# changed\n" }, true);
  assert.equal(auto.direct?.tool, "fs.write");
  assert.equal("sessionId" in (auto.direct ?? {}), false);

  const finish = directTask({ tool: "session.finish", sessionId: SESSION_ID, message: "test: finish session" }, true);
  assert.equal(finish.direct?.tool, "session.finish");
});

test("auto-session write returns a reusable session and finish commits, exports and closes it", async () => {
  const state = await gitFixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const written = await executor.execute(directTask({
      tool: "fs.write", autoSession: true, path: "README.md", content: "# after\n",
    }, true), "auto-write");
    assert.equal(written.status, "completed");
    const { sessionId } = dataOf<{ sessionId?: string }>(written);
    assert.ok(sessionId);
    assert.equal(state.sessions.list().length, 1);

    const read = await executor.execute(directTask({ tool: "fs.read", sessionId, path: "README.md" }), "auto-read");
    assert.deepEqual(dataOf(read), { content: "# after\n" });

    const finished = await executor.execute(directTask({
      tool: "session.finish", sessionId, message: "test: auto session finish",
    }, true), "auto-finish");
    assert.equal(finished.status, "completed");
    const data = dataOf<{ commit?: string; ref?: string; committed?: boolean }>(finished);
    assert.equal(data.committed, true);
    assert.match(data.commit ?? "", /^[0-9a-f]{40}$/u);
    assert.equal(data.ref, `refs/pet-dispatcher/${sessionId}`);
    assert.equal(state.sessions.list().length, 0);
    const resolved = await execFileAsync("git", ["-C", state.repo, "rev-parse", "--verify", `${data.ref}^{commit}`]);
    assert.equal(resolved.stdout.trim(), data.commit);
  } finally {
    for (const session of state.sessions.list()) await state.sessions.close(session.id, true).catch(() => undefined);
    state.sessions.dispose();
    await rm(state.base, { recursive: true, force: true });
  }
});

test("failed auto-session write discards the new writer lease", async () => {
  const state = await gitFixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const failed = await executor.execute(directTask({
      tool: "fs.patch", autoSession: true, path: "missing.txt", oldText: "before", newText: "after",
    }, true), "auto-failure");
    assert.equal(failed.status, "failed");
    assert.equal(state.sessions.list().length, 0);
  } finally {
    for (const session of state.sessions.list()) await state.sessions.close(session.id, true).catch(() => undefined);
    state.sessions.dispose();
    await rm(state.base, { recursive: true, force: true });
  }
});

test("adaptive remote polling backs off on idle/error and resets after work", () => {
  const nextPollInterval = (remoteTransport as unknown as {
    nextPollInterval?: (currentMs: number, handled: boolean, minMs: number, maxMs: number) => number;
  }).nextPollInterval;
  assert.ok(nextPollInterval, "remote transport should export nextPollInterval");
  assert.equal(nextPollInterval(1_000, false, 1_000, 8_000), 2_000);
  assert.equal(nextPollInterval(4_000, false, 1_000, 8_000), 8_000);
  assert.equal(nextPollInterval(8_000, false, 1_000, 8_000), 8_000);
  assert.equal(nextPollInterval(8_000, true, 1_000, 8_000), 1_000);
});

test("remote config preserves a bounded maximum poll interval", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-poll-config-"));
  try {
    const configPath = join(root, "dispatcher.json");
    await writeFile(configPath, JSON.stringify({
      workspaceRoot: "./worker", repositories: { fixture: "./repo" },
      remote: {
        enabled: true, deviceId: "legion", accountId: "a".repeat(32), queueId: "b".repeat(32),
        controlPlaneUrl: "https://control.example/", pollIntervalMs: 1_000, pollMaxIntervalMs: 8_000,
      },
    }));
    const config = await loadConfig(configPath);
    assert.equal((config.remote as typeof config.remote & { pollMaxIntervalMs?: number })?.pollMaxIntervalMs, 8_000);
    assert.equal(config.remote?.syncRepositories, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
