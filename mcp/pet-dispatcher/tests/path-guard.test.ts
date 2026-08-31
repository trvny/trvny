import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveExisting, resolveForCreate, resolveForWrite, validateRelativePath } from "../src/path-guard.js";
import type { Session } from "../src/sessions.js";
import { deleteWorkspace, readWorkspace } from "../src/workspace-fs.js";

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "pet-dispatcher-path-"));
  const root = join(base, "root");
  const outside = join(base, "outside");
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, "inside.txt"), "inside");
  await writeFile(join(outside, "secret.txt"), "secret");
  return { base, root, outside };
}

test("rejects absolute and traversal paths", async () => {
  const { base, root } = await fixture();
  try {
    assert.throws(() => validateRelativePath("C:\\Windows\\win.ini"));
    assert.throws(() => validateRelativePath("\\\\server\\share"));
    await assert.rejects(resolveExisting(root, "..\\outside\\secret.txt"), /escapes/);
  } finally { await rm(base, { recursive: true, force: true }); }
});
test("rejects junction or symlink escapes", async () => {
  const { base, root, outside } = await fixture();
  try {
    const link = join(root, "escape");
    await symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(resolveExisting(root, "escape/secret.txt"), /resolved path escapes/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("allows creating a file only below an existing in-root parent", async () => {
  const { base, root } = await fixture();
  try {
    await mkdir(join(root, "nested"));
    const target = await resolveForCreate(root, "nested/new.txt");
    assert.equal(target, join(root, "nested", "new.txt"));
    await assert.rejects(resolveForCreate(root, "../new.txt"), /escapes/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test("rejects writes through a file symlink that escapes the workspace", async (t) => {
  const { base, root, outside } = await fixture();
  try {
    const link = join(root, "escape-file.txt");
    try { await symlink(join(outside, "secret.txt"), link, "file"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("file symlinks require Windows Developer Mode"); return; }
      throw error;
    }
    await assert.rejects(resolveForWrite(root, "escape-file.txt"), /outside/);
  } finally { await rm(base, { recursive: true, force: true }); }
});


test("workspace reads reject oversized files before reading the body", async () => {
  const { base, root } = await fixture();
  try {
    await writeFile(join(root, "large.txt"), "x".repeat(64));
    const session = {
      id: "00000000-0000-4000-8000-000000000001", repo: "fixture", sessionDir: base,
      root, gitDir: join(base, "git"), sourceRoot: root, initialCommit: "deadbeef", readonlyRoots: [],
      network: { mode: "none", profile: null }, exportedCommit: null, exportedRef: null, createdAt: new Date(0).toISOString(),
    } satisfies Session;
    await assert.rejects(readWorkspace(session, "large.txt", 16), /exceeds 16 byte/);
  } finally { await rm(base, { recursive: true, force: true }); }
});


test("workspace delete removes a symlink entry without deleting its target", async () => {
  const { base, root } = await fixture();
  try {
    const target = join(root, "target");
    await mkdir(target);
    await writeFile(join(target, "keep.txt"), "keep");
    const link = join(root, "link");
    await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
    const session = { id: "00000000-0000-4000-8000-000000000002", repo: "fixture", sessionDir: base, root, gitDir: join(base, "git"), sourceRoot: root, initialCommit: "deadbeef", readonlyRoots: [], network: { mode: "none", profile: null }, exportedCommit: null, exportedRef: null, createdAt: new Date(0).toISOString() } satisfies Session;
    await deleteWorkspace(session, "link");
    await assert.rejects(lstat(link), /ENOENT/);
    assert.equal(await readFile(join(target, "keep.txt"), "utf8"), "keep");
  } finally { await rm(base, { recursive: true, force: true }); }
});
