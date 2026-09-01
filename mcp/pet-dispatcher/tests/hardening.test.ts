import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { DispatcherConfig } from "../src/config.js";
import { HostGit } from "../src/host-git.js";
import { validateRelativePath } from "../src/path-guard.js";
import type { Session } from "../src/sessions.js";
import { SessionManager } from "../src/sessions.js";
import { listWorkspace } from "../src/workspace-fs.js";

const execFileAsync = promisify(execFile);

async function gitFixture() {
  const base = await mkdtemp(join(tmpdir(), "pet-dispatcher-hardening-"));
  const repo = join(base, "repo");
  await mkdir(join(repo, "dir"), { recursive: true });
  await execFileAsync("git", ["init", repo]);
  await writeFile(join(repo, "dir", "file.txt"), "one\n");
  await execFileAsync("git", ["-C", repo, "add", "dir/file.txt"]);
  await execFileAsync("git", [
    "-C", repo,
    "-c", "user.name=Pet Test",
    "-c", "user.email=pet@example.invalid",
    "-c", "commit.gpgSign=false",
    "commit", "-m", "init",
  ]);
  const gitWhere = await execFileAsync(process.platform === "win32" ? "where.exe" : "which", ["git"]);
  const gitRoot = dirname(gitWhere.stdout.split(/\r?\n/u)[0] ?? "");
  const config = {
    workspaceRoot: join(base, "worker"),
    repositories: { fixture: repo },
    toolRoots: [gitRoot],
    networkProfiles: {},
    defaultTimeoutMs: 15_000,
    maxOutputBytes: 1_048_576,
    maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free",
    geminiModel: "gemini-2.5-flash",
  } satisfies DispatcherConfig;
  return { base, repo, config };
}

test("Windows device and ADS path syntax is rejected before filesystem access", () => {
  for (const path of ["NUL", "nul.txt", "dir/CONOUT$", "COM1.log", "nested/LPT9", "safe:stream"]) {
    assert.throws(() => validateRelativePath(path), /Windows|reserved|device|stream/iu);
  }
  assert.equal(validateRelativePath("nested/safe.txt"), "nested/safe.txt");
});

test("workspace listing is capped and marks truncation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-dispatcher-list-"));
  try {
    await Promise.all(Array.from({ length: 501 }, (_, index) =>
      writeFile(join(root, `file-${String(index).padStart(3, "0")}.txt`), "x")));
    const session = { root } as Session;
    const listing = await listWorkspace(session);
    assert.equal(listing.length, 501);
    assert.deepEqual(listing.at(-1), { truncated: true, limit: 500 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("session checkout owns its Git objects and stages a nested tracked deletion", async () => {
  const fixture = await gitFixture();
  const sessions = new SessionManager(fixture.config);
  let session: Session | undefined;
  try {
    session = await sessions.open("fixture");
    await assert.rejects(access(join(session.gitDir, "objects", "info", "alternates")));
    await rm(join(session.root, "dir"), { recursive: true, force: true });

    const git = new HostGit(sessions, fixture.config);
    const add = await git.add(session.id, ["dir/file.txt"]);
    assert.equal(add.exitCode, 0, add.stderr);
    const diff = await git.diff(session.id, true, ["dir/file.txt"]);
    assert.equal(diff.exitCode, 0, diff.stderr);
    assert.match(diff.stdout, /deleted file mode|^-one$/mu);
  } finally {
    if (session) await sessions.close(session.id, true);
    await rm(fixture.base, { recursive: true, force: true });
  }
});

test("dead-owner session directories are reclaimed before the next session opens", async () => {
  const fixture = await gitFixture();
  const orphan = join(fixture.config.workspaceRoot, "sessions", "orphan");
  await mkdir(orphan, { recursive: true });
  await writeFile(join(orphan, "owner.json"), JSON.stringify({ pid: 99_999_999 }), "utf8");
  await writeFile(join(orphan, "leftover.txt"), "stale", "utf8");

  const sessions = new SessionManager(fixture.config);
  let session: Session | undefined;
  try {
    session = await sessions.open("fixture");
    await assert.rejects(access(orphan));
  } finally {
    if (session) await sessions.close(session.id, true);
    await rm(fixture.base, { recursive: true, force: true });
  }
});

test("session close canonicalizes a junction-backed workspace root", async () => {
  const fixture = await gitFixture();
  const realWorkspace = join(fixture.base, "worker-real");
  const linkedWorkspace = join(fixture.base, "worker-link");
  await mkdir(realWorkspace);
  await symlink(realWorkspace, linkedWorkspace, process.platform === "win32" ? "junction" : "dir");
  fixture.config.workspaceRoot = linkedWorkspace;
  const sessions = new SessionManager(fixture.config);
  const first = await sessions.open("fixture");
  await sessions.close(first.id, true);
  const second = await sessions.open("fixture");
  await sessions.close(second.id, true);
  await rm(fixture.base, { recursive: true, force: true });
});
