import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveExisting, resolveForCreate, validateRelativePath } from "../src/path-guard.js";

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
