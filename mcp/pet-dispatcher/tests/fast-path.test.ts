import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { DispatcherConfig } from "../src/config.js";
import { HostGit } from "../src/host-git.js";
import type { Session } from "../src/sessions.js";
import { SessionManager } from "../src/sessions.js";
import { readManyWorkspace, searchWorkspace, treeWorkspace } from "../src/workspace-fs.js";

const execFileAsync = promisify(execFile);

function fsSession(root: string): Session {
  return {
    id: "11111111-1111-4111-8111-111111111111", repo: "fixture", targetKind: "workspace", writable: false,
    sessionDir: root, root, gitDir: root, sourceRoot: root, initialCommit: "deadbeef", readonlyRoots: [],
    network: { mode: "none", profile: null }, exportedCommit: null, exportedRef: null,
    createdAt: new Date(0).toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

test("readMany returns bounded structured file results", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-fast-fs-"));
  try {
    await writeFile(join(root, "a.txt"), "alpha\n");
    await writeFile(join(root, "b.txt"), `${"€".repeat(20)}\n`);
    const result = await readManyWorkspace(fsSession(root), ["a.txt", "b.txt"], {
      maxBytesPerFile: 17, maxTotalBytes: 24,
    });
    assert.equal(result.files.length, 2);
    assert.deepEqual(result.files[0], { path: "a.txt", content: "alpha\n", truncated: false });
    assert.equal(result.files[1]?.path, "b.txt");
    assert.equal(result.files[1]?.truncated, true);
    assert.doesNotMatch(result.files[1]?.content ?? "", /�/u);
    assert.ok(result.totalBytes <= 24);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("tree is depth, entry and byte bounded", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-fast-tree-"));
  try {
    await mkdir(join(root, "src", "nested"), { recursive: true });
    await writeFile(join(root, "src", "one.ts"), "one\n");
    await writeFile(join(root, "src", "nested", "two.ts"), "two\n");
    const result = await treeWorkspace(fsSession(root), ".", { depth: 1, maxEntries: 10, maxBytes: 96 });
    assert.ok(result.entries.some((entry) => entry.path === "src" && entry.type === "directory"));
    assert.ok(result.entries.some((entry) => entry.path === "src/one.ts"));
    assert.equal(result.entries.some((entry) => entry.path === "src/nested/two.ts"), false);
    assert.ok(Buffer.byteLength(JSON.stringify(result.entries), "utf8") <= 96);
    const tiny = await treeWorkspace(fsSession(root), ".", { depth: 8, maxEntries: 100, maxBytes: 40 });
    assert.equal(tiny.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(tiny.entries), "utf8") <= 40);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("search returns bounded line previews without dumping files", async () => {
  const root = await mkdtemp(join(tmpdir(), "pet-fast-search-"));
  try {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "one.ts"), "alpha\nneedle first\nomega\n");
    await writeFile(join(root, "src", "two.ts"), "needle second\n");
    const result = await searchWorkspace(fsSession(root), {
      query: "needle", path: "src", maxMatches: 10, maxFiles: 10, maxFileBytes: 4_096, maxDepth: 3, maxBytes: 96,
    });
    assert.ok(result.matches.length >= 1);
    assert.equal(result.matches[0]?.path, "src/one.ts");
    assert.equal(result.matches[0]?.line, 2);
    assert.match(result.matches[0]?.preview ?? "", /needle first/u);
    assert.ok(Buffer.byteLength(JSON.stringify(result.matches), "utf8") <= 96);
    const tiny = await searchWorkspace(fsSession(root), {
      query: "needle", path: "src", maxMatches: 10, maxFiles: 10, maxFileBytes: 4_096, maxDepth: 3, maxBytes: 48,
    });
    assert.equal(tiny.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(tiny.matches), "utf8") <= 48);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("git summary returns branch/head/status/log in one structured call", async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-fast-git-"));
  const repo = join(base, "repo");
  await mkdir(repo);
  await execFileAsync("git", ["init", repo]);
  await writeFile(join(repo, "README.md"), "one\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md"]);
  await execFileAsync("git", ["-C", repo, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "init"]);
  const gitWhere = await execFileAsync(process.platform === "win32" ? "where.exe" : "which", ["git"]);
  const config = {
    workspaceRoot: join(base, "worker"), repositories: { fixture: repo }, toolRoots: [dirname(gitWhere.stdout.split(/\r?\n/u)[0] ?? "")],
    networkProfiles: {}, defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  } satisfies DispatcherConfig;
  const sessions = new SessionManager(config);
  const session = await sessions.open("fixture");
  try {
    await writeFile(join(session.root, "README.md"), "two\n");
    const summary = await new HostGit(sessions, config).summary(session.id, 3);
    assert.match(summary.head, /^[0-9a-f]{40}$/u);
    assert.equal(summary.dirty, true);
    assert.ok(summary.recent.length >= 1 && summary.recent.length <= 3);
    assert.ok(summary.unstaged.files >= 1);
    assert.ok("ahead" in summary && "behind" in summary);
  } finally {
    await sessions.close(session.id, true);
    await rm(base, { recursive: true, force: true });
  }
});
