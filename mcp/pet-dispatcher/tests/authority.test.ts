import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { AuthorityPolicy, authorityConfigSchema, tierForExecutor, type AuthorityConfig } from "../src/authority.js";
import { loadConfig } from "../src/config.js";
import { deviceMetaSchema } from "../src/device-meta.js";
import { remoteCapabilitySchema, remoteTaskSchema } from "../src/remote-protocol.js";

const HOME = "C:\\Users\\tester";
const INSTALL = "C:\\Users\\tester\\.local\\share\\pet-dispatcher";
const identity = async (path: string) => path;

async function policy(config: Partial<AuthorityConfig> | undefined, now = () => 1_000_000) {
  return AuthorityPolicy.create(config === undefined ? undefined : authorityConfigSchema.parse(config), {
    home: HOME, installRoot: INSTALL, canonicalize: identity, now,
  });
}

test("host mode is off by default and by an incomplete config", async () => {
  for (const config of [undefined, {}, { grantable: ["host.exec" as const] }, { roots: [HOME] }]) {
    const p = await policy(config);
    assert.deepEqual(p.enabledCapabilities(), []);
    assert.equal(p.evaluate("host.exec", "operator-interactive").allowed, false);
    assert.throws(() => p.grant("host.fs.read", "operator-interactive", 5), /not grantable/u);
  }
});

test("only listed capabilities can be granted, and a signed request cannot widen that", async () => {
  const p = await policy({ grantable: ["host.fs.read"], roots: ["C:\\Users\\tester\\git"] });
  assert.deepEqual(p.enabledCapabilities(), ["host.fs.read"]);
  assert.throws(() => p.grant("host.exec", "operator-interactive", 5), /not grantable/u);
  assert.equal(p.evaluate("host.fs.read", "operator-interactive").allowed, false, "no lease yet");
  p.grant("host.fs.read", "operator-interactive", 5);
  assert.equal(p.evaluate("host.fs.read", "operator-interactive").allowed, true);
  assert.equal(p.evaluate("host.exec", "operator-interactive").allowed, false);
});

test("leases expire, are capped by maxLeaseMinutes and can be revoked", async () => {
  let clock = 1_000_000;
  const p = await policy({ grantable: ["host.fs.read", "host.exec"], roots: ["C:\\work"], maxLeaseMinutes: 10 }, () => clock);
  const capped = p.grant("host.exec", "operator-interactive", 240);
  assert.equal(capped.expiresAt - capped.grantedAt, 10 * 60_000);
  const short = p.grant("host.fs.read", "operator-interactive", 1);
  clock += 61_000;
  assert.equal(p.evaluate("host.fs.read", "operator-interactive").allowed, false, "expired");
  assert.equal(p.list().length, 1);
  assert.equal(p.revoke(capped.id), true);
  assert.equal(p.evaluate("host.exec", "operator-interactive").allowed, false);
  assert.equal(p.revoke(short.id), false);
  p.grant("host.exec", "operator-interactive", 1);
  p.revokeAll();
  assert.equal(p.list().length, 0);
});

test("trust tiers: delegates never hold exec or write, and the tier comes from the executor", async () => {
  const p = await policy({ grantable: ["host.fs.read", "host.fs.write", "host.exec", "process.manage"], roots: ["C:\\work"] });
  assert.equal(tierForExecutor("direct"), "operator-interactive");
  for (const executor of ["openrouter", "deepseek", "gemini"] as const) assert.equal(tierForExecutor(executor), "untrusted-delegate");
  assert.throws(() => p.grant("host.fs.read", "untrusted-delegate", 5), /may not hold/u);
  assert.throws(() => p.grant("host.exec", "trusted-delegate", 5), /may not hold/u);
  p.grant("host.fs.read", "trusted-delegate", 5);
  assert.equal(p.evaluate("host.fs.read", "trusted-delegate").allowed, true);
  assert.equal(p.evaluate("host.fs.read", "operator-interactive").allowed, false, "a lease belongs to its tier");
});

test("paths: inside a root, outside the floor, canonical windows rules", async () => {
  const p = await policy({ grantable: ["host.fs.read", "host.fs.write"], roots: ["C:\\Users\\tester", "D:\\data"] });
  const ok = (path: string, mode: "read" | "write") => p.evaluatePath(path, mode).allowed;
  assert.equal(ok("C:\\Users\\tester\\git\\repo\\a.txt", "read"), true);
  assert.equal(ok("c:\\USERS\\Tester\\GIT\\repo\\a.txt", "write"), true, "case-insensitive");
  assert.equal(ok("D:\\data\\x.bin", "write"), true);
  assert.equal(ok("C:\\Windows\\System32\\cmd.exe", "read"), false, "outside every root");
  assert.equal(ok("C:\\Users\\tester2\\a.txt", "read"), false, "sibling with a shared prefix");
  assert.equal(ok("C:\\Users\\tester\\..\\other\\a.txt", "read"), false);
  assert.equal(ok("C:foo.txt", "read"), false, "drive-relative");
  assert.equal(ok("\\\\?\\C:\\Users\\tester\\a.txt", "read"), false, "device path");
  assert.equal(ok("\\\\.\\PhysicalDrive0", "read"), false, "device path");
  assert.equal(ok("C:\\Users\\tester\\git\\a.txt::$DATA", "read"), false, "alternate data stream");
  assert.equal(ok("C:\\Users\\tester\\git\\a.txt:hidden", "write"), false, "alternate data stream");
  assert.equal(ok("C:\\Users\\tester\\git\\NUL", "write"), false, "reserved name");
  assert.equal(ok("C:\\Users\\tester\\git\\con.txt", "read"), false, "reserved name with extension");
  assert.equal(ok("\\\\server\\share\\a.txt", "read"), false, "UNC outside the roots");
});

test("policy floor: the install root, credential stores and code-exec write paths", async () => {
  const p = await policy({ grantable: ["host.fs.read", "host.fs.write"], roots: [HOME] });
  const decision = (path: string, mode: "read" | "write") => p.evaluatePath(path, mode).allowed;
  // A lease that can only write files must not be able to rewrite the allowlist, the startup scripts or the secrets.
  for (const path of [`${INSTALL}\\config\\dispatcher.json`, `${INSTALL}\\bin\\pet-dispatcher-supervise.js`, `${INSTALL}\\secrets\\x.dpapi`]) {
    assert.equal(decision(path, "write"), false, `write ${path}`);
    assert.equal(decision(path, "read"), false, `read ${path}`);
  }
  for (const path of [`${HOME}\\.ssh\\id_ed25519`, `${HOME}\\.engram\\vault-key`, `${HOME}\\.local\\share\\claude-backup\\staging\\a`, `${HOME}\\.claude\\.credentials.json`]) {
    assert.equal(decision(path, "read"), false, `read ${path}`);
    assert.equal(decision(path, "write"), false, `write ${path}`);
  }
  for (const path of [`${HOME}\\.claude\\settings.json`, `${HOME}\\Documents\\PowerShell\\profile.ps1`, `${HOME}\\.bashrc`,
    `${HOME}\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\run.cmd`]) {
    assert.equal(decision(path, "write"), false, `write ${path}`);
  }
  assert.equal(decision(`${HOME}\\.claude\\settings.json`, "read"), true, "reading settings is fine");
  for (const name of [".env", ".env.local", "server.pem", "api.key", "hosts.yml", "auth.json", ".npmrc", ".git-credentials"]) {
    assert.equal(decision(`${HOME}\\git\\repo\\${name}`, "read"), false, `read ${name}`);
  }
  assert.equal(decision(`${HOME}\\git\\repo\\README.md`, "read"), true);
  assert.equal(decision(`${HOME}\\git\\repo\\README.md`, "write"), true);
});

test("trailing dots and spaces cannot dodge the name rules or the floor", async () => {
  const p = await policy({ grantable: ["host.fs.read", "host.fs.write"], roots: [HOME] });
  for (const name of [".bashrc.", ".bashrc ", "settings.json.", ".bashrc. ."]) {
    assert.equal(p.evaluatePath(`${HOME}\\${name}`, "write").allowed, false, `write ${name}`);
  }
  assert.equal(p.evaluatePath(`${HOME}\\git\\secret.pem.`, "read").allowed, false, "secret.pem. is secret.pem on disk");
  assert.equal(p.evaluatePath(`${HOME}\\git\\notes `, "read").allowed, false);
  assert.equal(p.evaluatePath(`${HOME}\\git\\.hidden`, "read").allowed, true, "a leading dot is fine");
});

test("floor entries follow junctions the same way roots do", async () => {
  // ~/dir/.dc is a junction to D:\dc: the canonical spelling of a protected path must still be denied.
  const canonicalize = async (path: string) => path.toLowerCase().startsWith("c:\\users\\tester\\dir\\.dc") ? path.replace(/^c:\\users\\tester\\dir\\.dc/iu, "D:\\dc") : path;
  const p = await AuthorityPolicy.create(authorityConfigSchema.parse({ grantable: ["host.fs.read", "host.fs.write"], roots: ["C:\\Users\\tester\\dir\\.dc"] }), {
    home: HOME, installRoot: INSTALL, canonicalize,
  });
  assert.equal(p.evaluatePath("D:\\dc\\tools\\a.txt", "write").allowed, true, "the root itself resolves to D:\\dc");
  for (const protectedPath of ["D:\\dc\\pet-dispatcher-workspace\\sessions\\x\\a", "D:\\dc\\.secrets\\pet-dispatcher\\k.dpapi", "D:\\dc\\pet-dispatcher\\dispatcher.live.json"]) {
    assert.equal(p.evaluatePath(protectedPath, "read").allowed, false, `read ${protectedPath}`);
    assert.equal(p.evaluatePath(protectedPath, "write").allowed, false, `write ${protectedPath}`);
  }
});

test("writes that become code execution are denied under every root, extra denies apply", async () => {
  const p = await AuthorityPolicy.create(authorityConfigSchema.parse({ grantable: ["host.fs.write", "host.fs.read"], roots: ["C:\\Users\\tester\\git", "E:\\work"] }), {
    home: HOME, installRoot: INSTALL, extraDeny: ["E:\\work\\sessions"], canonicalize: identity,
  });
  for (const path of ["C:\\Users\\tester\\git\\repo\\.git\\hooks\\pre-commit", "C:\\Users\\tester\\git\\repo\\.git\\config", "E:\\work\\proj\\.claude\\settings.json",
    "C:\\Users\\tester\\git\\repo\\.GIT\\hooks\\post-checkout", `${HOME}\\.gitconfig`]) {
    assert.equal(p.evaluatePath(path, "write").allowed, false, `write ${path}`);
  }
  assert.equal(p.evaluatePath("C:\\Users\\tester\\git\\repo\\.git\\HEAD", "read").allowed, true, "reading git metadata stays possible");
  assert.equal(p.evaluatePath("C:\\Users\\tester\\git\\repo\\.gitignore", "write").allowed, true, "only the .git directory segment is special");
  assert.equal(p.evaluatePath("E:\\work\\sessions\\s1\\a.txt", "read").allowed, false, "extraDeny (the worker's session root)");
  assert.equal(p.evaluatePath("E:\\work\\proj\\a.txt", "write").allowed, true);
});

test("no executor can carry a host capability yet (the enum addition is inert)", () => {
  const base = { repo: "r", baseRef: "main", timeoutMinutes: 2, network: { mode: "none" } };
  for (const capability of ["host.fs.read", "host.exec", "process.manage"]) {
    assert.throws(() => remoteTaskSchema.parse({ ...base, executor: "openrouter", goal: "x", capabilities: [capability] }), /not available yet/u, `agent ${capability}`);
    assert.throws(() => remoteTaskSchema.parse({ ...base, executor: "direct", direct: { tool: "fs.read", path: "a" }, profile: "inspect", capabilities: [capability] }), /not available yet/u);
  }
});

test("roots that cannot be canonicalized grant nothing", async () => {
  const p = await AuthorityPolicy.create(authorityConfigSchema.parse({ grantable: ["host.fs.read"], roots: ["C:\\missing"] }), {
    home: HOME, canonicalize: async () => { throw new Error("ENOENT"); },
  });
  assert.deepEqual(p.enabledCapabilities(), []);
});

test("config and protocol plumbing: authority block, device meta field, capability enum", async () => {
  assert.throws(() => authorityConfigSchema.parse({ grantable: ["host.root"] }));
  assert.throws(() => authorityConfigSchema.parse({ unknownKey: 1 }));
  for (const capability of ["host.fs.read", "host.fs.write", "host.exec", "process.manage"]) assert.doesNotThrow(() => remoteCapabilitySchema.parse(capability));
  const meta = {
    deviceId: "legion", transport: "cloudflare-queues-http-pull", protocol: 1, updatedAt: new Date().toISOString(), repositories: [], workspaces: [],
    directTools: [], activeSessions: 0, activeProcesses: 0, sandbox: { supported: true, processGuard: "x", networkDefault: "deny" },
  };
  assert.equal(deviceMetaSchema.parse(meta).hostCapabilities, undefined, "omitted while host mode is off");
  assert.deepEqual(deviceMetaSchema.parse({ ...meta, hostCapabilities: ["host.fs.read"] }).hostCapabilities, ["host.fs.read"]);
});

test("loadConfig resolves authority roots against the config directory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pet-authority-"));
  try {
    const path = join(dir, "dispatcher.json");
    await writeFile(path, JSON.stringify({
      workspaceRoot: "ws", repositories: {}, authority: { grantable: ["host.fs.read"], roots: ["shared", "C:\abs"] },
    }));
    const config = await loadConfig(path);
    assert.deepEqual(config.authority?.grantable, ["host.fs.read"]);
    assert.equal(config.authority?.roots[0], resolve(dir, "shared"));
    const bare = join(dir, "bare.json");
    await writeFile(bare, JSON.stringify({ workspaceRoot: "ws", repositories: {} }));
    assert.equal((await loadConfig(bare)).authority, undefined, "no authority block = host mode off");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
