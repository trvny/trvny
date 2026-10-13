import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { AuthorityPolicy, authorityConfigSchema } from "../src/authority.js";
import type { DispatcherConfig } from "../src/config.js";
import { runHostFs, type HostFsOpResult } from "../src/host-fs.js";
import { ConfinedRemoteExecutor } from "../src/remote-executor.js";
import { buildHostFsTask, hostFsCallSchema } from "../src/remote-protocol.js";

const execFileAsync = promisify(execFile);
const windowsOnly = { skip: process.platform !== "win32" };

// Real directories, real realpath: the pure path rules are covered in authority.test.ts, this proves the filesystem
// resolution (junctions, 8.3 names) feeds them the right canonical path.
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "pet-hostfs-")));
  const home = join(base, "home");
  const work = join(home, "work");
  const outside = join(base, "outside");
  const install = join(work, "pet-dispatcher-install-directory");
  await Promise.all([mkdir(work, { recursive: true }), mkdir(outside), mkdir(install, { recursive: true }), mkdir(join(home, ".ssh"), { recursive: true })]);
  await writeFile(join(work, "a.txt"), "hello host\n");
  await writeFile(join(work, ".env"), "SECRET=1\n");
  await writeFile(join(outside, "secret.txt"), "outside\n");
  await writeFile(join(home, ".ssh", "id_ed25519"), "PRIVATE KEY\n");
  await writeFile(join(home, ".ssh", "known_hosts"), "host key\n");
  await writeFile(join(install, "dispatcher.json"), "{}\n");
  const policy = await AuthorityPolicy.create(authorityConfigSchema.parse({ grantable: ["host.fs.read"], roots: [home] }), { home, installRoot: install });
  return { base, home, work, outside, install, policy };
}

const run = (policy: AuthorityPolicy, ops: unknown[]) => runHostFs(policy, hostFsCallSchema.parse({ ops }));
const errorOf = (result: HostFsOpResult | undefined) => (result && "error" in result ? result.error : undefined);

test("reads, stats and lists inside a root; credential-shaped and floored entries are not revealed", windowsOnly, async () => {
  const f = await fixture();
  try {
    const { results } = await run(f.policy, [
      { op: "read", path: join(f.work, "a.txt") },
      { op: "stat", path: join(f.work, "a.txt") },
      { op: "list", path: f.work },
      { op: "list", path: f.home },
    ]);
    assert.deepEqual(results[0], { op: "read", path: join(f.work, "a.txt"), content: "hello host\n", bytes: 11, truncated: false });
    assert.equal((results[1] as { type: string }).type, "file");
    const workList = results[2] as { entries: { name: string }[]; hidden: number };
    assert.deepEqual(workList.entries.map((e) => e.name).sort(), ["a.txt", "pet-dispatcher-install-directory"].sort().filter((n) => n !== "pet-dispatcher-install-directory"));
    assert.equal(workList.hidden, 2, ".env and the install directory are hidden, not listed");
    const homeList = results[3] as { entries: { name: string }[]; hidden: number };
    assert.deepEqual(homeList.entries.map((e) => e.name), ["work"]);
    assert.equal(homeList.hidden, 1, ".ssh is hidden");
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("refusals: outside the roots, the floor, credential names, streams, devices and relative paths", windowsOnly, async () => {
  const f = await fixture();
  try {
    const { results } = await run(f.policy, [
      { op: "read", path: join(f.outside, "secret.txt") },
      { op: "read", path: join(f.home, ".ssh", "id_ed25519") },
      { op: "read", path: join(f.work, ".env") },
      { op: "read", path: join(f.install, "dispatcher.json") },
      { op: "read", path: `${join(f.work, "a.txt")}::$DATA` },
      { op: "read", path: join(f.work, "NUL") },
      { op: "read", path: "relative\\a.txt" },
      { op: "read", path: join(f.work, "missing.txt") },
    ]);
    for (const [index, result] of results.entries()) assert.ok(errorOf(result), `op ${index} must be refused: ${JSON.stringify(result)}`);
    assert.match(errorOf(results[0])!, /outside the granted roots/u);
    assert.match(errorOf(results[1])!, /policy floor/u);
    assert.match(errorOf(results[2])!, /credential-shaped/u);
    assert.match(errorOf(results[3])!, /policy floor/u);
    assert.equal(errorOf(results[7]), "no such file or directory", "a missing file leaks no path");
    for (const result of results) assert.equal(JSON.stringify(result).includes(f.base.replaceAll("\\", "\\\\")) && !("path" in result), false);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("junctions cannot lead out of a root or into the floor", windowsOnly, async (t) => {
  const f = await fixture();
  try {
    try {
      await symlink(f.outside, join(f.work, "to-outside"), "junction");
      await symlink(join(f.home, ".ssh"), join(f.work, "to-ssh"), "junction");
      await symlink(f.install, join(f.work, "to-install"), "junction");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") { t.skip("junction creation is unavailable on this host"); return; }
      throw error;
    }
    const { results } = await run(f.policy, [
      { op: "read", path: join(f.work, "to-outside", "secret.txt") },
      { op: "read", path: join(f.work, "to-ssh", "known_hosts") },
      { op: "read", path: join(f.work, "to-install", "dispatcher.json") },
      { op: "list", path: join(f.work, "to-outside") },
      { op: "list", path: f.work },
    ]);
    for (const index of [0, 1, 2, 3]) assert.ok(errorOf(results[index]), `junction op ${index}: ${JSON.stringify(results[index])}`);
    assert.match(errorOf(results[0])!, /outside the granted roots/u);
    assert.match(errorOf(results[1])!, /policy floor/u);
    const listing = results[4] as { entries: { name: string }[]; hidden: number };
    assert.deepEqual(listing.entries.map((e) => e.name), ["a.txt"], "junction children that lead outside or into the floor are hidden");
    assert.equal(listing.hidden, 5, ".env, the install dir and the three junctions");
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("an 8.3 short name of a floored directory resolves to the floored path", windowsOnly, async (t) => {
  const f = await fixture();
  try {
    const script = "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:PET_TEST_DIR).ShortPath";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { env: { ...process.env, PET_TEST_DIR: f.install } });
    const short = stdout.trim();
    if (!short.includes("~")) { t.skip("8.3 short names are disabled on this volume"); return; }
    // The premise the canonical floor check relies on: realpath expands 8.3 names to the long, floored path.
    assert.equal((await realpath(join(short, "dispatcher.json"))).toLowerCase(), join(f.install, "dispatcher.json").toLowerCase());
    // The fully shortened spelling is refused (its lexical form is not inside a granted root)...
    const { results } = await run(f.policy, [
      { op: "read", path: join(short, "dispatcher.json") },
      { op: "read", path: join(f.work, "a.txt") },
      // ...and the case that matters: a LONG root with only the floored component shortened passes every lexical
      // check, so only the canonical floor can stop it.
      { op: "read", path: join(f.work, basename(short), "dispatcher.json") },
    ]);
    assert.ok(errorOf(results[0]), `via ${short}`);
    assert.equal(errorOf(results[1]), undefined, "the long spelling of an allowed file still works");
    assert.match(errorOf(results[2]) ?? "", /policy floor/u, `via ${join(f.work, basename(short))}`);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("reads are bounded and cut on a code point boundary", windowsOnly, async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.work, "big.txt"), "zażółć gęślą jaźń ".repeat(5_000));
    await writeFile(join(f.work, "b.txt"), "second\n");
    const { results, truncated } = await run(f.policy, [
      { op: "read", path: join(f.work, "big.txt"), maxBytes: 101 },
      { op: "read", path: join(f.work, "b.txt") },
    ]);
    const big = results[0] as { content: string; bytes: number; truncated: boolean };
    assert.ok(big.bytes <= 101 && big.truncated);
    assert.equal(big.content.includes("�"), false, "no broken character at the cut");
    assert.equal((results[1] as { content: string }).content, "second\n");
    assert.equal(truncated, true);
    const many = await run(f.policy, Array.from({ length: 16 }, () => ({ op: "read", path: join(f.work, "big.txt"), maxBytes: 65_536 })));
    const total = many.results.reduce((sum, r) => sum + ("bytes" in r ? r.bytes : 0), 0);
    assert.ok(total <= 72 * 1_024, `total ${total}`);
    assert.equal(many.results.length, 16, "every op gets an answer: later reads share what is left instead of failing");
    assert.equal(many.truncated, true);
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("the serialized result stays under the callback limit, however the bytes escape", windowsOnly, async () => {
  const f = await fixture();
  try {
    const crowded = join(f.work, "crowded");
    await mkdir(crowded);
    await Promise.all(Array.from({ length: 300 }, (_, i) => writeFile(join(crowded, `entry-with-a-long-name-${String(i).padStart(4, "0")}.txt`), "x")));
    await writeFile(join(f.work, "escapes.txt"), '\\"\\"\\"\\\\'.repeat(20_000));
    const lists = await run(f.policy, Array.from({ length: 16 }, () => ({ op: "list", path: crowded })));
    const heavy = await run(f.policy, [{ op: "read", path: join(f.work, "escapes.txt"), maxBytes: 65_536 }, { op: "read", path: join(f.work, "escapes.txt"), maxBytes: 65_536 }]);
    for (const outcome of [lists, heavy]) {
      const bytes = Buffer.byteLength(JSON.stringify(outcome), "utf8");
      assert.ok(bytes <= 96 * 1_024 - 4_096, `${bytes} bytes serialized`);
      assert.equal(outcome.truncated, true);
    }
    assert.equal(lists.results.length > 0, true);
    assert.ok(lists.results.some((r) => "entries" in r && r.entries.length > 0 && r.truncated), "a list is trimmed, not dropped");
    assert.ok(heavy.results.some((r) => "content" in r && r.content.length > 0 && r.truncated), "an escape-heavy read is cut to fit");
  } finally { await rm(f.base, { recursive: true, force: true }); }
});

test("the executor runs a host task only for the owner route", windowsOnly, async () => {
  const f = await fixture();
  try {
    const config = { workspaceRoot: join(f.base, "ws"), repositories: {}, workspaces: {}, toolRoots: [] } as unknown as DispatcherConfig;
    const executor = new ConfinedRemoteExecutor(config, {} as never, {} as never, undefined, undefined, f.policy);
    const task = buildHostFsTask(hostFsCallSchema.parse({ ops: [{ op: "read", path: join(f.work, "a.txt") }] }));
    const owner = await executor.execute(task, "t1", undefined, { route: "owner" });
    assert.equal(owner.status, "completed");
    assert.equal(((owner.data as { results: { content: string }[] }).results[0])?.content, "hello host\n");
    for (const route of ["connector", undefined] as const) {
      const refused = await executor.execute(task, "t2", undefined, { route });
      assert.equal(refused.status, "failed");
      assert.equal(refused.data, undefined, "a refused call returns no data");
    }
  } finally { await rm(f.base, { recursive: true, force: true }); }
});
