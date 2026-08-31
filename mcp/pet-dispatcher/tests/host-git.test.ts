import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { DispatcherConfig } from "../src/config.js";
import { HostGit } from "../src/host-git.js";
import { SessionManager } from "../src/sessions.js";

const execFileAsync = promisify(execFile);

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "pet-dispatcher-git-"));
  const repo = join(base, "repo");
  await mkdir(repo);
  await execFileAsync("git", ["init", repo]);
  await writeFile(join(repo, "README.md"), "one\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md"]);
  await execFileAsync("git", ["-C", repo, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "init"]);
  const gitWhere = await execFileAsync("where.exe", ["git"]);
  const gitRoot = dirname(gitWhere.stdout.split(/\r?\n/u)[0] ?? "");
  const config = {
    workspaceRoot: join(base, "worker"), repositories: { fixture: repo }, toolRoots: [gitRoot], networkProfiles: {},
    defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  } satisfies DispatcherConfig;
  const sessions = new SessionManager(config);
  const session = await sessions.open("fixture");
  return { base, repo, sessions, session, git: new HostGit(sessions, config) };
}

test("host Git adapter is bound to the session checkout", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.session.root, "README.md"), "two\n");
    const status = await f.git.status(f.session.id);
    assert.equal(status.exitCode, 0);
    assert.match(status.stdout, /README\.md/);

    const diff = await f.git.diff(f.session.id);
    assert.match(diff.stdout, /-one/);
    assert.match(diff.stdout, /\+two/);

    await assert.rejects(f.git.add(f.session.id, ["..\\outside.txt"]), /escapes|relative|absolute|segments/);
    const add = await f.git.add(f.session.id, ["README.md"]);
    assert.equal(add.exitCode, 0);
  } finally {
    await f.sessions.close(f.session.id, true);
    await rm(f.base, { recursive: true, force: true });
  }
});
test("host Git commit uses dispatcher identity without host Git config", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.session.root, "new.txt"), "hello\n");
    assert.equal((await f.git.add(f.session.id, ["new.txt"])).exitCode, 0);
    const commit = await f.git.commit(f.session.id, "test: safe host git");
    assert.equal(commit.exitCode, 0, commit.stderr);
    const { stdout } = await execFileAsync("git", ["-C", f.session.root, "log", "-1", "--format=%an <%ae>%n%s"]);
    assert.match(stdout, /GPTomek <314538226\+gptomek\[bot\]@users\.noreply\.github\.com>/);
    assert.match(stdout, /test: safe host git/);
  } finally {
    await f.sessions.close(f.session.id, true);
    await rm(f.base, { recursive: true, force: true });
  }
});

test("host Git status does not dirty an otherwise unchanged checkout", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.git.status(f.session.id)).exitCode, 0);
    assert.equal((await f.sessions.status(f.session.id)).dirty, false);
    await f.sessions.close(f.session.id);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("export preserves the current commit before clean session close", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.session.root, "exported.txt"), "keep me\n");
    assert.equal((await f.git.add(f.session.id, ["exported.txt"])).exitCode, 0);
    assert.equal((await f.git.commit(f.session.id, "test: export commit")).exitCode, 0);
    await assert.rejects(f.sessions.close(f.session.id), /unexported/);
    const exported = await f.git.exportCommit(f.session.id);
    assert.match(exported.ref, /^refs\/pet-dispatcher\//u);
    const { stdout } = await execFileAsync("git", ["-C", f.repo, "rev-parse", "--verify", `${exported.ref}^{commit}`]);
    assert.equal(stdout.trim(), exported.commit);
    await f.sessions.close(f.session.id);
    const preserved = await execFileAsync("git", ["-C", f.repo, "rev-parse", "--verify", `${exported.ref}^{commit}`]);
    assert.equal(preserved.stdout.trim(), exported.commit);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});
