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
import { remoteTaskSchema } from "../src/remote-protocol.js";
import { SessionManager } from "../src/sessions.js";

const execFileAsync = promisify(execFile);

async function fixture() {
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
    workspaceRoot: join(base, "worker"), repositories: { fixture: repo }, toolRoots: [gitRoot], networkProfiles: {},
    defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  } satisfies DispatcherConfig;
  return { base, config, sessions: new SessionManager(config) };
}

test("direct remote fs.read uses an isolated session and returns bounded output", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  const task = remoteTaskSchema.parse({
    repo: "fixture", baseRef: "HEAD", executor: "direct", profile: "inspect",
    capabilities: ["workspace.read", "git.read"], network: { mode: "none" }, timeoutMinutes: 2,
    direct: { tool: "fs.read", path: "README.md" },
  });
  try {
    const result = await executor.execute(task, "direct-test");
    assert.equal(result.status, "completed");
    const output = JSON.parse(result.output ?? "{}") as { content?: string };
    assert.equal(output.content, "# direct bridge\n");
    assert.equal(state.sessions.list().length, 0);
  } finally {
    for (const session of state.sessions.list()) {
      await state.sessions.close(session.id, true).catch(() => undefined);
    }
    await rm(state.base, { recursive: true, force: true });
  }
});

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

test("direct write session persists across calls and exports the committed head", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open");
    assert.equal(opened.status, "completed");
    const openOutput = JSON.parse(opened.output ?? "{}") as { sessionId?: string };
    assert.ok(openOutput.sessionId);
    const sessionId = openOutput.sessionId;
    assert.equal((await executor.execute(directTask({
      tool: "fs.write", sessionId, path: "README.md", content: "# direct write bridge\n",
    }, true), "write")).status, "completed");
    const readBack = await executor.execute(directTask({
      tool: "fs.read", sessionId, path: "README.md",
    }), "read-back");
    assert.equal(readBack.status, "completed");
    const readOutput = JSON.parse(readBack.output ?? "{}") as { content?: string };
    assert.equal(readOutput.content, "# direct write bridge\n");
    assert.equal((await executor.execute(directTask({
      tool: "git.add", sessionId, paths: ["README.md"],
    }, true), "add")).status, "completed");
    const committed = await executor.execute(directTask({
      tool: "git.commit", sessionId, message: "test: direct write bridge",
    }, true), "commit");
    assert.equal(committed.status, "completed");
    assert.match(committed.commit ?? "", /^[0-9a-f]{40}$/u);
    assert.equal(committed.exportedRef, `refs/pet-dispatcher/${sessionId}`);
    const resolved = await execFileAsync("git", [
      "-C", state.config.repositories.fixture,
      "rev-parse", "--verify", `${committed.exportedRef}^{commit}`,
    ]);
    assert.equal(resolved.stdout.trim(), committed.commit);
    const closed = await executor.execute(directTask({
      tool: "session.close", sessionId, discard: false,
    }, true), "close");
    assert.equal(closed.status, "completed");
    assert.equal(state.sessions.list().length, 0);
  } finally {
    for (const session of state.sessions.list()) {
      await state.sessions.close(session.id, true).catch(() => undefined);
    }
    await rm(state.base, { recursive: true, force: true });
  }
});

test("direct write session survives a refused clean close until explicitly discarded", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open-dirty");
    const { sessionId } = JSON.parse(opened.output ?? "{}") as { sessionId?: string };
    assert.ok(sessionId);
    assert.equal((await executor.execute(directTask({
      tool: "fs.write", sessionId, path: "dirty.txt", content: "still here\n",
    }, true), "dirty-write")).status, "completed");
    const refused = await executor.execute(directTask({
      tool: "session.close", sessionId, discard: false,
    }, true), "close-refused");
    assert.equal(refused.status, "failed");
    assert.match(refused.error ?? "", /unexported changes/u);
    assert.equal(state.sessions.list().length, 1);
    const discarded = await executor.execute(directTask({
      tool: "session.close", sessionId, discard: true,
    }, true), "close-discard");
    assert.equal(discarded.status, "completed");
    assert.equal(state.sessions.list().length, 0);
  } finally {
    for (const session of state.sessions.list()) await state.sessions.close(session.id, true).catch(() => undefined);
    await rm(state.base, { recursive: true, force: true });
  }
});

test("clean direct close exports a committed head that was not previously exported", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  try {
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 30 }, true), "open-recovery");
    const { sessionId } = JSON.parse(opened.output ?? "{}") as { sessionId?: string };
    assert.ok(sessionId);
    assert.equal((await executor.execute(directTask({
      tool: "fs.write", sessionId, path: "README.md", content: "# recover export\n",
    }, true), "write-recovery")).status, "completed");

    const git = new HostGit(state.sessions, state.config);
    assert.equal((await git.add(sessionId, ["README.md"])).exitCode, 0);
    assert.equal((await git.commit(sessionId, "test: recovery commit")).exitCode, 0);
    const before = await state.sessions.status(sessionId);
    assert.equal(before.changedHead, true);
    assert.equal(before.dirty, false);
    assert.equal(before.session.exportedCommit, null);

    const closed = await executor.execute(directTask({
      tool: "session.close", sessionId, discard: false,
    }, true), "close-recovery");
    assert.equal(closed.status, "completed");
    assert.match(closed.commit ?? "", /^[0-9a-f]{40}$/u);
    assert.equal(closed.exportedRef, `refs/pet-dispatcher/${sessionId}`);
    const resolved = await execFileAsync("git", [
      "-C", state.config.repositories.fixture,
      "rev-parse", "--verify", `${closed.exportedRef}^{commit}`,
    ]);
    assert.equal(resolved.stdout.trim(), closed.commit);
    assert.equal(state.sessions.list().length, 0);
  } finally {
    for (const session of state.sessions.list()) await state.sessions.close(session.id, true).catch(() => undefined);
    await rm(state.base, { recursive: true, force: true });
  }
});

test("expired direct write session is discarded on the next session-bound call", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  const originalNow = Date.now;
  try {
    const openedAt = originalNow();
    const opened = await executor.execute(directTask({ tool: "session.open", ttlMinutes: 1 }, true), "open-expiry");
    const { sessionId } = JSON.parse(opened.output ?? "{}") as { sessionId?: string };
    assert.ok(sessionId);
    Date.now = () => openedAt + 61_000;
    const expired = await executor.execute(directTask({
      tool: "fs.read", sessionId, path: "README.md",
    }), "read-expired");
    assert.equal(expired.status, "failed");
    assert.match(expired.error ?? "", /expired/u);
    for (let attempt = 0; attempt < 50 && state.sessions.list().length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(state.sessions.list().length, 0);
  } finally {
    Date.now = originalNow;
    for (const session of state.sessions.list()) await state.sessions.close(session.id, true).catch(() => undefined);
    await rm(state.base, { recursive: true, force: true });
  }
});

test("direct write schema rejects execution and network capabilities", () => {
  const parsed = remoteTaskSchema.safeParse({
    repo: "fixture", baseRef: "HEAD", executor: "direct", profile: "code",
    capabilities: ["workspace.read", "workspace.write", "git.read", "git.commit", "process.exec"],
    network: { mode: "none" }, timeoutMinutes: 2,
    direct: { tool: "session.open", ttlMinutes: 30 },
  });
  assert.equal(parsed.success, false);
});
