import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { DispatcherConfig } from "../src/config.js";
import { HostGit } from "../src/host-git.js";
import { SessionManager } from "../src/sessions.js";
import { deleteWorkspace, readWorkspace, writeWorkspace } from "../src/workspace-fs.js";

const execFileAsync = promisify(execFile);

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "pet-workspace-session-"));
  const repo = join(base, "repo");
  const dc = join(base, "dc");
  const outside = join(base, "outside");
  await Promise.all([mkdir(repo), mkdir(dc), mkdir(outside)]);
  await execFileAsync("git", ["init", repo]);
  await writeFile(join(repo, "README.md"), "fixture\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md"]);
  await execFileAsync("git", ["-C", repo, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "init"]);
  const gitWhere = await execFileAsync(process.platform === "win32" ? "where.exe" : "which", ["git"]);
  const gitRoot = dirname(gitWhere.stdout.split(/\r?\n/u)[0] ?? "");
  const config = {
    workspaceRoot: join(base, "worker"), repositories: { fixture: repo }, workspaces: { dc }, toolRoots: [gitRoot],
    networkProfiles: {}, defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  } as unknown as DispatcherConfig;
  return { base, repo, dc, outside, config, sessions: new SessionManager(config) };
}

test("non-git workspace is a confined writable target without Git semantics", async () => {
  const state = await fixture();
  try {
    const session = await state.sessions.open("dc");
    assert.equal((session as { targetKind?: string }).targetKind, "workspace");
    assert.equal(session.root, await realpath(state.dc));
    await writeWorkspace(session, "hello.txt", "hello\n");
    assert.equal(await readWorkspace(session, "hello.txt"), "hello\n");
    await assert.rejects(new HostGit(state.sessions, state.config).status(session.id), /workspace|Git target/i);
    await state.sessions.close(session.id, true);
    assert.equal(await readWorkspace({ ...session, root: state.dc }, "hello.txt"), "hello\n");
  } finally {
    for (const session of state.sessions.list()) await state.sessions.close(session.id, true).catch(() => undefined);
    await rm(state.base, { recursive: true, force: true });
  }
});

test("workspace deletion cannot delete its root or follow an escaping symlink", async (t) => {
  const state = await fixture();
  try {
    const session = await state.sessions.open("dc");
    await writeFile(join(state.outside, "secret.txt"), "outside\n");
    try {
      await symlink(state.outside, join(state.dc, "escape"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") {
        t.skip("symlink creation is unavailable on this host");
        return;
      }
      throw error;
    }
    await assert.rejects(readWorkspace(session, "escape/secret.txt"), /escapes the session workspace/);
    await assert.rejects(deleteWorkspace(session, "."), /root|escapes or replaces/);
    await writeWorkspace(session, "delete-me.txt", "bye\n");
    await deleteWorkspace(session, "delete-me.txt");
    await assert.rejects(readWorkspace(session, "delete-me.txt"));
    await state.sessions.close(session.id, true);
  } finally {
    for (const session of state.sessions.list()) await state.sessions.close(session.id, true).catch(() => undefined);
    await rm(state.base, { recursive: true, force: true });
  }
});

test("discard close releases a writer lease even when Git metadata is already broken", async () => {
  const state = await fixture();
  try {
    const session = await state.sessions.open("fixture");
    await rm(session.gitDir, { recursive: true, force: true });
    await state.sessions.close(session.id, true);
    const reopened = await state.sessions.open("fixture");
    await state.sessions.close(reopened.id, true);
  } finally {
    for (const session of state.sessions.list()) await state.sessions.close(session.id, true).catch(() => undefined);
    await rm(state.base, { recursive: true, force: true });
  }
});

test("expired sessions can be reclaimed safely while the worker stays alive", async () => {
  const state = await fixture();
  try {
    const session = await state.sessions.open("fixture");
    (session as { expiresAt?: string }).expiresAt = new Date(Date.now() - 1_000).toISOString();
    const reclaimed = await (state.sessions as unknown as { reclaim(id: string): Promise<boolean> }).reclaim(session.id);
    assert.equal(reclaimed, true);
    assert.equal(state.sessions.list().length, 0);
    const reopened = await state.sessions.open("fixture");
    await state.sessions.close(reopened.id, true);
  } finally {
    for (const session of state.sessions.list()) await state.sessions.close(session.id, true).catch(() => undefined);
    await rm(state.base, { recursive: true, force: true });
  }
});
