import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { DispatcherConfig } from "../src/config.js";
import { HostGit } from "../src/host-git.js";
import { ConfinedRemoteExecutor } from "../src/remote-executor.js";
import { remoteTaskSchema, type RemoteResult } from "../src/remote-protocol.js";
import { CommandRunner } from "../src/sandbox.js";
import { SessionManager } from "../src/sessions.js";

const execFileAsync = promisify(execFile);

function dataOf<T>(result: RemoteResult): T {
  return result.data as T;
}

async function fixture(maxOutputBytes = 1_048_576) {
  const base = await mkdtemp(join(tmpdir(), "pet-direct-"));
  const repo = join(base, "repo");
  await mkdir(repo);
  await execFileAsync("git", ["init", repo]);
  await writeFile(join(repo, "README.md"), "# direct bridge\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md"]);
  await execFileAsync("git", ["-C", repo, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "-c", "commit.gpgSign=false", "commit", "-m", "init"]);
  const gitWhere = await execFileAsync(process.platform === "win32" ? "where.exe" : "which", ["git"]);
  const gitRoot = dirname(gitWhere.stdout.split(/\r?\n/u)[0] ?? "");
  const config = {
    workspaceRoot: join(base, "worker"), repositories: { fixture: repo }, toolRoots: [gitRoot], networkProfiles: { build: { hosts: ["registry.npmjs.org"] } },
    defaultTimeoutMs: 15_000, maxOutputBytes, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  } satisfies DispatcherConfig;
  return { base, config, sessions: new SessionManager(config) };
}

function directTask(call: Record<string, unknown>, write = false) {
  return remoteTaskSchema.parse({
    repo: "fixture", baseRef: "HEAD", executor: "direct",
    profile: write ? "code" : "inspect",
    capabilities: write
      ? ["workspace.read", "workspace.write", "git.read", "git.commit"]
      : ["workspace.read", "git.read"],
    network: { mode: "none" }, timeoutMinutes: 2, direct: call,
  });
}

function directExecTask(call: Record<string, unknown>) {
  return remoteTaskSchema.parse({
    repo: "fixture", baseRef: "HEAD", executor: "direct", profile: "code",
    capabilities: ["workspace.read", "workspace.write", "process.exec", "git.read", "git.commit"],
    network: { mode: "none" }, timeoutMinutes: 2, direct: call,
  });
}

function directNetworkExecTask(call: Record<string, unknown>) {
  return remoteTaskSchema.parse({
    repo: "fixture", baseRef: "HEAD", executor: "direct", profile: "code",
    capabilities: ["workspace.read", "workspace.write", "process.exec", "git.read", "git.commit", "network.fetch"],
    network: { mode: "brokered", profile: "build" }, timeoutMinutes: 2,
    direct: { networkProfile: "build", ...call },
  });
}
async function cleanup(state: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  for (const session of state.sessions.list()) await state.sessions.close(session.id, true).catch(() => undefined);
  await rm(state.base, { recursive: true, force: true });
}

test("direct remote fs.read uses an isolated session and structured output", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const result = await executor.execute(directTask({ tool: "fs.read", path: "README.md" }), "direct-test");
    assert.equal(result.status, "completed");
    assert.deepEqual(dataOf(result), { content: "# direct bridge\n" });
    assert.equal(result.output, undefined);
    assert.equal(state.sessions.list().length, 0);
  } finally { await cleanup(state); }
});

test("direct system.status answers without opening a session or touching the repo", async () => {
  const state = await fixture();
  const runner = { activeProcessCount: () => 0 } as never;
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, runner);
  try {
    const result = await executor.execute(directTask({ tool: "system.status" }), "status-test");
    assert.equal(result.status, "completed");
    const data = dataOf<{
      hostname: string; uptimeSeconds: number; freeMemBytes: number; totalMemBytes: number;
      activeSessions: number; activeProcesses: number;
    }>(result);
    assert.equal(typeof data.hostname, "string");
    assert.ok(data.uptimeSeconds >= 0);
    assert.ok(data.freeMemBytes > 0);
    assert.ok(data.totalMemBytes > 0);
    assert.equal(data.activeSessions, 0);
    assert.equal(data.activeProcesses, 0);
    assert.equal(state.sessions.list().length, 0);
  } finally { await cleanup(state); }
});

test("direct workspace.exec reuses a write session without depending on Git inside MXC", { skip: process.platform !== "win32" }, async () => {
  const state = await fixture();
  const runner = await CommandRunner.create(state.config, state.sessions);
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, runner);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open-exec");
    const { sessionId } = dataOf<{ sessionId?: string }>(opened);
    assert.ok(sessionId);
    const executed = await executor.execute(directExecTask({
      tool: "workspace.exec", sessionId, argv: ["cmd", "/d", "/s", "/c", "echo PET_OK"], timeoutMs: 10_000,
    }), "exec");
    assert.equal(executed.status, "completed");
    const output = dataOf<{ exitCode?: number; stdout?: string; truncated?: boolean }>(executed);
    assert.equal(output.exitCode, 0);
    assert.match(output.stdout ?? "", /PET_OK/u);
    assert.equal(output.truncated, false);
    assert.equal(state.sessions.list().length, 1);
    assert.equal((await executor.execute(directTask({ tool: "session.close", sessionId, discard: true }, true), "close-exec")).status, "completed");
  } finally {
    await runner.close();
    await cleanup(state);
  }
});

test("networked direct workspace.exec opens and preserves the signed profile", async () => {
  const state = await fixture();
  const runner = {
    exec: async (sessionId: string) => {
      assert.deepEqual(state.sessions.get(sessionId).network, { mode: "brokered", profile: "build" });
      return { exitCode: 0, stdout: "NET_OK\n", stderr: "", truncated: false, durationMs: 1 };
    },
  } as never;
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, runner);
  try {
    const executed = await executor.execute(directNetworkExecTask({
      tool: "workspace.exec", autoSession: true, argv: ["node", "--version"], timeoutMs: 10_000,
    }), "network-exec");
    assert.equal(executed.status, "completed");
    const data = dataOf<{ sessionId?: string; stdout?: string }>(executed);
    assert.ok(data.sessionId);
    assert.match(data.stdout ?? "", /NET_OK/u);
    assert.deepEqual(state.sessions.get(data.sessionId).network, { mode: "brokered", profile: "build" });
    const downgraded = await executor.execute(directExecTask({
      tool: "workspace.exec", sessionId: data.sessionId, argv: ["node", "--version"], timeoutMs: 10_000,
    }), "network-downgrade");
    assert.equal(downgraded.status, "failed");
    assert.match(downgraded.error ?? "", /network profile does not match/u);
    assert.equal((await executor.execute(directTask({ tool: "session.close", sessionId: data.sessionId, discard: true }, true), "network-close")).status, "completed");
  } finally { await cleanup(state); }
});
test("direct workspace.exec truncates UTF-8 on complete code point boundaries", async () => {
  const state = await fixture();
  const runner = { exec: async () => ({ exitCode: 0, stdout: `a${"€".repeat(8192)}`, stderr: "", truncated: false, durationMs: 1 }) } as never;
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, runner);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open-utf8");
    const { sessionId } = dataOf<{ sessionId?: string }>(opened);
    assert.ok(sessionId);
    const executed = await executor.execute(directExecTask({
      tool: "workspace.exec", sessionId, argv: ["git", "--version"], timeoutMs: 10_000,
    }), "exec-utf8");
    const output = dataOf<{ stdout?: string; truncated?: boolean }>(executed);
    assert.equal(executed.status, "completed");
    assert.equal(output.truncated, true);
    assert.ok(Buffer.byteLength(output.stdout ?? "", "utf8") <= 24 * 1_024);
    assert.doesNotMatch(output.stdout ?? "", /�/u);
  } finally { await cleanup(state); }
});

test("pre-cancelled direct call returns cancelled without touching the session", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, { exec: async () => { throw new Error("should not run"); } } as never);
  const controller = new AbortController();
  controller.abort(new Error("remote task cancellation requested"));
  try {
    const result = await executor.execute(directExecTask({
      tool: "workspace.exec", sessionId: "11111111-1111-4111-8111-111111111111", argv: ["git", "--version"], timeoutMs: 10_000,
    }), "pre-cancelled", controller.signal);
    assert.equal(result.status, "cancelled");
    assert.match(result.error ?? "", /cancellation requested/u);
    assert.equal(state.sessions.list().length, 0);
  } finally { await cleanup(state); }
});

test("direct write session persists across calls and exports the committed head", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open");
    const { sessionId } = dataOf<{ sessionId?: string }>(opened);
    assert.ok(sessionId);
    assert.equal((await executor.execute(directTask({ tool: "fs.write", sessionId, path: "README.md", content: "# direct write bridge\n" }, true), "write")).status, "completed");
    const readBack = await executor.execute(directTask({ tool: "fs.read", sessionId, path: "README.md" }), "read-back");
    assert.deepEqual(dataOf(readBack), { content: "# direct write bridge\n" });
    assert.equal((await executor.execute(directTask({ tool: "git.add", sessionId, paths: ["README.md"] }, true), "add")).status, "completed");
    const committed = await executor.execute(directTask({ tool: "git.commit", sessionId, message: "test: direct write bridge" }, true), "commit");
    assert.equal(committed.status, "completed");
    assert.match(committed.commit ?? "", /^[0-9a-f]{40}$/u);
    assert.equal(committed.exportedRef, `refs/pet-dispatcher/${sessionId}`);
    const resolved = await execFileAsync("git", ["-C", state.config.repositories.fixture, "rev-parse", "--verify", `${committed.exportedRef}^{commit}`]);
    assert.equal(resolved.stdout.trim(), committed.commit);
    assert.equal((await executor.execute(directTask({ tool: "session.close", sessionId, discard: false }, true), "close")).status, "completed");
    assert.equal(state.sessions.list().length, 0);
  } finally { await cleanup(state); }
});

test("direct write session survives a refused clean close until explicitly discarded", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open-dirty");
    const { sessionId } = dataOf<{ sessionId?: string }>(opened);
    assert.ok(sessionId);
    assert.equal((await executor.execute(directTask({ tool: "fs.write", sessionId, path: "dirty.txt", content: "still here\n" }, true), "dirty-write")).status, "completed");
    const refused = await executor.execute(directTask({ tool: "session.close", sessionId, discard: false }, true), "close-refused");
    assert.equal(refused.status, "failed");
    assert.match(refused.error ?? "", /unexported changes/u);
    assert.equal(state.sessions.list().length, 1);
    assert.equal((await executor.execute(directTask({ tool: "session.close", sessionId, discard: true }, true), "close-discard")).status, "completed");
    assert.equal(state.sessions.list().length, 0);
  } finally { await cleanup(state); }
});

test("clean direct close exports a committed head that was not previously exported", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open-recovery");
    const { sessionId } = dataOf<{ sessionId?: string }>(opened);
    assert.ok(sessionId);
    assert.equal((await executor.execute(directTask({ tool: "fs.write", sessionId, path: "README.md", content: "# recover export\n" }, true), "write-recovery")).status, "completed");
    const git = new HostGit(state.sessions, state.config);
    assert.equal((await git.add(sessionId, ["README.md"])).exitCode, 0);
    assert.equal((await git.commit(sessionId, "test: recovery commit")).exitCode, 0);
    const before = await state.sessions.status(sessionId);
    assert.equal(before.changedHead, true);
    assert.equal(before.dirty, false);
    assert.equal(before.session.exportedCommit, null);
    const closed = await executor.execute(directTask({ tool: "session.close", sessionId, discard: false }, true), "close-recovery");
    assert.match(closed.commit ?? "", /^[0-9a-f]{40}$/u);
    assert.equal(closed.exportedRef, `refs/pet-dispatcher/${sessionId}`);
    const resolved = await execFileAsync("git", ["-C", state.config.repositories.fixture, "rev-parse", "--verify", `${closed.exportedRef}^{commit}`]);
    assert.equal(resolved.stdout.trim(), closed.commit);
    assert.equal(state.sessions.list().length, 0);
  } finally { await cleanup(state); }
});

test("expired direct write session is discarded on the next session-bound call", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  const originalNow = Date.now;
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 1 }, true), "open-expiry");
    const { sessionId, expiresAt } = dataOf<{ sessionId?: string; expiresAt?: string }>(opened);
    assert.ok(sessionId);
    assert.ok(expiresAt);
    Date.now = () => Date.parse(expiresAt) + 1;
    const expired = await executor.execute(directTask({ tool: "fs.read", sessionId, path: "README.md" }), "read-expired");
    assert.equal(expired.status, "failed");
    assert.match(expired.error ?? "", /expired/u);
    for (let attempt = 0; attempt < 50 && state.sessions.list().length; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(state.sessions.list().length, 0);
  } finally {
    Date.now = originalNow;
    await cleanup(state);
  }
});

test("direct remote filesystem workflow exposes safe session status and cleanup", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open-fs");
    const { sessionId } = dataOf<{ sessionId?: string }>(opened);
    assert.ok(sessionId);
    assert.equal((await executor.execute(directTask({ tool: "fs.mkdir", sessionId, path: "scratch" }, true), "mkdir")).status, "completed");
    assert.equal((await executor.execute(directTask({ tool: "fs.write", sessionId, path: "scratch/a.txt", content: "alpha beta\n" }, true), "write")).status, "completed");
    assert.equal((await executor.execute(directTask({ tool: "fs.patch", sessionId, path: "scratch/a.txt", oldText: "beta", newText: "gamma" }, true), "patch")).status, "completed");
    assert.equal((await executor.execute(directTask({ tool: "fs.move", sessionId, from: "scratch/a.txt", to: "scratch/b.txt" }, true), "move")).status, "completed");
    const status = await executor.execute(directTask({ tool: "session.status", sessionId }), "status");
    const statusData = dataOf<{ dirty?: boolean; session?: Record<string, unknown> }>(status);
    assert.equal(statusData.dirty, true);
    assert.equal(statusData.session?.id, sessionId);
    assert.equal(statusData.session?.repo, "fixture");
    assert.equal(statusData.session?.alias, "fixture");
    for (const privateField of ["root", "sessionDir", "sourceRoot", "gitDir"]) assert.equal(privateField in (statusData.session ?? {}), false);
    const read = await executor.execute(directTask({ tool: "fs.read", sessionId, path: "scratch/b.txt" }), "read-patched");
    assert.equal(dataOf<{ content?: string }>(read).content, "alpha gamma\n");
    assert.equal((await executor.execute(directTask({ tool: "fs.delete", sessionId, path: "scratch" }, true), "delete")).status, "completed");
    assert.equal((await executor.execute(directTask({ tool: "session.close", sessionId, discard: false }, true), "close-fs")).status, "completed");
    assert.equal(state.sessions.list().length, 0);
  } finally { await cleanup(state); }
});

test("direct write schema rejects execution and network capabilities", () => {
  const parsed = remoteTaskSchema.safeParse({
    repo: "fixture", baseRef: "HEAD", executor: "direct", profile: "code",
    capabilities: ["workspace.read", "workspace.write", "git.read", "git.commit", "process.exec"],
    network: { mode: "none" }, timeoutMinutes: 2, direct: { tool: "session.open", ttlMinutes: 30 },
  });
  assert.equal(parsed.success, false);
});

test("direct exec schema requires process.exec and caps task lifetime", () => {
  const base = {
    repo: "fixture", baseRef: "HEAD", executor: "direct", profile: "code", network: { mode: "none" },
    direct: { tool: "workspace.exec", sessionId: "11111111-1111-4111-8111-111111111111", argv: ["git", "--version"], timeoutMs: 900_000 },
  };
  assert.equal(remoteTaskSchema.safeParse({ ...base, capabilities: ["workspace.read", "workspace.write", "process.exec", "git.read", "git.commit"], timeoutMinutes: 15 }).success, true);
  assert.equal(remoteTaskSchema.safeParse({ ...base, capabilities: ["workspace.read", "workspace.write", "git.read", "git.commit"], timeoutMinutes: 15 }).success, false);
  assert.equal(remoteTaskSchema.safeParse({ ...base, capabilities: ["workspace.read", "workspace.write", "process.exec", "git.read", "git.commit"], timeoutMinutes: 16 }).success, false);
});

test("workspace inspect combines bounded tree, optional search and Git summary", async () => {
  const state = await fixture();
  const repo = state.config.repositories.fixture;
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    await mkdir(join(repo, "src"));
    await writeFile(join(repo, "src", "main.ts"), "alpha\nneedle here\nomega\n");
    await execFileAsync("git", ["-C", repo, "add", "src/main.ts"]);
    await execFileAsync("git", ["-C", repo, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "add source"]);

    const result = await executor.execute(directTask({
      tool: "workspace.inspect", path: ".", query: "needle", include: ["tree", "git"],
      depth: 2, maxEntries: 20, maxMatches: 10, maxFiles: 20, maxFileBytes: 4_096, maxDepth: 3, maxCommits: 2,
    }), "workspace-inspect");
    assert.equal(result.status, "completed");
    const data = dataOf<{
      targetKind?: string; tree?: { entries?: Array<{ path?: string }> };
      search?: { matches?: Array<{ path?: string; line?: number }> };
      git?: { head?: string; recent?: unknown[] };
    }>(result);
    assert.equal(data.targetKind, "repository");
    assert.ok(data.tree?.entries?.some((entry) => entry.path === "src/main.ts"));
    assert.equal(data.search?.matches?.[0]?.path, "src/main.ts");
    assert.equal(data.search?.matches?.[0]?.line, 2);
    assert.match(data.git?.head ?? "", /^[0-9a-f]{40}$/u);
    assert.ok((data.git?.recent?.length ?? 0) <= 2);
    assert.equal(state.sessions.list().length, 0);
  } finally { await cleanup(state); }
});

test("workspace inspect waits for every started branch before failing", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  const originalSummary = HostGit.prototype.summary;
  let releaseSummary!: () => void;
  let summaryStarted = false;
  const summaryGate = new Promise<void>((resolve) => { releaseSummary = resolve; });
  HostGit.prototype.summary = async () => {
    summaryStarted = true;
    await summaryGate;
    return {
      branch: "main", head: "0".repeat(40), upstream: null, ahead: null, behind: null, dirty: false,
      staged: { files: 0, paths: [] }, unstaged: { files: 0, paths: [] }, recent: [],
    };
  };
  try {
    let settled = false;
    const observed = executor.execute(directTask({
      tool: "workspace.inspect", path: "../escape", include: ["tree", "git"],
    }), "workspace-inspect-settle").then((value) => { settled = true; return value; });
    while (!summaryStarted) await new Promise((resolve) => setTimeout(resolve, 1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(settled, false);
    releaseSummary();
    const outcome = await observed;
    assert.equal(outcome.status, "failed");
    assert.equal(state.sessions.list().length, 0);
  } finally {
    HostGit.prototype.summary = originalSummary;
    releaseSummary?.();
    await cleanup(state);
  }
});

test("workspace inspect trims Git paths to the shared callback budget", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  const originalSummary = HostGit.prototype.summary;
  HostGit.prototype.summary = async () => {
    const paths = Array.from({ length: 50 }, (_, index) => `${"deep/".repeat(300)}file-${index}.txt`);
    return {
      branch: "main", head: "0".repeat(40), upstream: null, ahead: 0, behind: 0, dirty: true,
      staged: { files: paths.length, paths: [...paths] }, unstaged: { files: paths.length, paths: [...paths] }, recent: [],
    };
  };
  try {
    const result = await executor.execute(directTask({
      tool: "workspace.inspect", path: ".", include: ["tree", "git"], maxTreeBytes: 32_768, maxGitPaths: 50,
    }), "workspace-inspect-budget");
    assert.equal(result.status, "completed");
    const data = dataOf<{ git?: { staged: { paths: string[] }; unstaged: { paths: string[] } } }>(result);
    assert.ok((data.git?.staged.paths.length ?? 50) < 50 || (data.git?.unstaged.paths.length ?? 50) < 50);
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 96 * 1_024);
  } finally {
    HostGit.prototype.summary = originalSummary;
    await cleanup(state);
  }
});

test("workspace inspect keeps non-Git workspaces Git-free", async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-inspect-workspace-"));
  const workspace = join(base, "dc");
  await mkdir(workspace);
  await writeFile(join(workspace, "notes.txt"), "needle in workspace\n");
  const config = {
    workspaceRoot: join(base, "worker"), repositories: {}, workspaces: { dc: workspace }, toolRoots: [], networkProfiles: {},
    defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  } satisfies DispatcherConfig;
  const sessions = new SessionManager(config);
  const executor = new ConfinedRemoteExecutor(config, sessions, {} as never);
  try {
    const task = remoteTaskSchema.parse({
      repo: "dc", baseRef: "main", executor: "direct", profile: "inspect",
      capabilities: ["workspace.read", "git.read"], network: { mode: "none" }, timeoutMinutes: 2,
      direct: { tool: "workspace.inspect", path: ".", query: "needle", include: ["tree", "git"], maxEntries: 20 },
    });
    const result = await executor.execute(task, "inspect-workspace");
    assert.equal(result.status, "completed");
    const data = dataOf<{ targetKind?: string; git?: unknown; tree?: { entries?: Array<{ path?: string }> }; search?: { matches?: Array<{ path?: string }> } }>(result);
    assert.equal(data.targetKind, "workspace");
    assert.equal(data.git, null);
    assert.ok(data.tree?.entries?.some((entry) => entry.path === "notes.txt"));
    assert.equal(data.search?.matches?.[0]?.path, "notes.txt");
    assert.equal(sessions.list().length, 0);
  } finally {
    for (const session of sessions.list()) await sessions.close(session.id, true).catch(() => undefined);
    await rm(base, { recursive: true, force: true });
  }
});

test("direct fast-path filesystem and Git summaries stay structured", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open-fast");
    const { sessionId } = dataOf<{ sessionId?: string }>(opened);
    assert.ok(sessionId);
    assert.equal((await executor.execute(directTask({ tool: "fs.write", sessionId, path: "notes.txt", content: "alpha\nneedle here\nomega\n" }, true), "notes")).status, "completed");
    const readMany = await executor.execute(directTask({ tool: "fs.readMany", sessionId, paths: ["README.md", "notes.txt"] }), "read-many");
    const many = dataOf<{ files?: Array<{ path?: string; content?: string }> }>(readMany);
    assert.equal(many.files?.length, 2);
    const tree = dataOf<{ entries?: Array<{ path?: string }> }>(await executor.execute(directTask({ tool: "fs.tree", sessionId, depth: 2, maxEntries: 20 }), "tree"));
    assert.ok(tree.entries?.some((entry) => entry.path === "notes.txt"));
    const search = dataOf<{ matches?: Array<{ path?: string; line?: number }> }>(await executor.execute(directTask({ tool: "fs.search", sessionId, query: "needle" }), "search"));
    assert.equal(search.matches?.[0]?.path, "notes.txt");
    assert.equal(search.matches?.[0]?.line, 2);
    const summary = dataOf<{ head?: string; dirty?: boolean; recent?: unknown[] }>(await executor.execute(directTask({ tool: "git.summary", sessionId, maxCommits: 2 }), "git-summary"));
    assert.match(summary.head ?? "", /^[0-9a-f]{40}$/u);
    assert.equal(summary.dirty, true);
    assert.ok((summary.recent?.length ?? 0) >= 1);
  } finally { await cleanup(state); }
});

test("direct exec strips ANSI and enforces one combined tail budget", async () => {
  const state = await fixture(1_024);
  const runner = {
    exec: async () => ({
      exitCode: 7,
      stdout: `\u001b[31m${"out-".repeat(500)}TAIL_OUT\u001b[0m`,
      stderr: `\u001b[33m${"err-".repeat(500)}TAIL_ERR\u001b[0m`,
      truncated: false, durationMs: 3, peakMemoryBytes: 1234, killReason: null,
    }),
  } as never;
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, runner);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open-output");
    const { sessionId } = dataOf<{ sessionId?: string }>(opened);
    assert.ok(sessionId);
    const executed = await executor.execute(directExecTask({
      tool: "workspace.exec", sessionId, argv: ["fake"], timeoutMs: 10_000,
      maxOutputBytes: 1_024, outputMode: "tail", stripAnsi: true,
    }), "exec-output");
    const data = dataOf<{ stdout?: string; stderr?: string; truncated?: boolean; peakMemoryBytes?: number }>(executed);
    assert.equal(executed.status, "completed");
    assert.equal(data.truncated, true);
    assert.equal(data.peakMemoryBytes, 1234);
    assert.doesNotMatch(`${data.stdout ?? ""}${data.stderr ?? ""}`, /\u001b\[/u);
    assert.ok(Buffer.byteLength(`${data.stdout ?? ""}${data.stderr ?? ""}`, "utf8") <= 1_024);
    assert.match(data.stderr ?? "", /TAIL_ERR/u);
  } finally { await cleanup(state); }
});
