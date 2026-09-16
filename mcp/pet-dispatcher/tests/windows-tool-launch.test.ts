import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import type { DispatcherConfig } from "../src/config.js";
import { CommandRunner } from "../src/sandbox.js";
import { SessionManager } from "../src/sessions.js";

test("Windows MXC launches PATH-resolved Node without inheriting dispatcher secrets", { skip: process.platform !== "win32" }, async () => {
  const base = await mkdtemp(join(tmpdir(), "pet-windows-tool-"));
  const workspace = join(base, "workspace");
  const worker = join(base, "worker");
  await mkdir(workspace);
  await mkdir(worker);
  const config: DispatcherConfig = {
    workspaceRoot: worker, repositories: {}, workspaces: { fixture: workspace }, toolRoots: [], networkProfiles: {},
    defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  };
  const sessions = new SessionManager(config);
  const runner = await CommandRunner.create(config, sessions);
  const previous = process.env.PET_SECRET_SENTINEL;
  process.env.PET_SECRET_SENTINEL = "MUST_NOT_LEAK";
  let sessionId: string | undefined;
  try {
    const session = await sessions.open("fixture");
    sessionId = session.id;
    if (runner.systemDrivePrepRequired) {
      await assert.rejects(
        runner.exec(session.id, ["node", "--version"]),
        /wxc-host-prep prepare-system-drive/u,
      );
      return;
    }
    const result = await runner.exec(session.id, [
      "node", "-e", "console.log('NODE_OK|' + (process.env.PET_SECRET_SENTINEL || 'clean'))",
    ]);
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /NODE_OK\|clean/u);
    assert.doesNotMatch(result.stdout, /MUST_NOT_LEAK/u);
    const npmVersion = await runner.exec(session.id, ["npm", "--version"]);
    assert.equal(npmVersion.exitCode, 0, npmVersion.stderr || npmVersion.stdout);
    assert.match(npmVersion.stdout.trim(), /^\d+\.\d+\.\d+$/u);
  } finally {
    if (previous === undefined) delete process.env.PET_SECRET_SENTINEL;
    else process.env.PET_SECRET_SENTINEL = previous;
    if (sessionId) await sessions.close(sessionId, true).catch(() => undefined);
    await runner.close().catch(() => undefined);
    sessions.dispose();
    await rm(base, { recursive: true, force: true });
  }
});


test("Windows MXC brokered exec allows only the exact-host proxy port", { skip: process.platform !== "win32" }, async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pet-windows-network-"));
  const workspace = join(base, "workspace");
  const worker = join(base, "worker");
  await Promise.all([mkdir(workspace), mkdir(worker)]);
  const config: DispatcherConfig = {
    workspaceRoot: worker, repositories: {}, workspaces: { fixture: workspace }, toolRoots: [],
    networkProfiles: { build: { hosts: ["registry.npmjs.org"] } },
    defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
    environmentPolicy: { secretNamePattern: "TOKEN|KEY|SECRET|PASS|AUTH",
      sandboxPassthrough: ["PET_ALLOWED_MARKER"], sandboxReadonlyPathVariables: [], networkProfileSecrets: {} },
  };
  const sessions = new SessionManager(config);
  const runner = await CommandRunner.create(config, sessions);
  if (runner.systemDrivePrepRequired) {
    t.skip("MXC host requires system-drive preparation");
    await runner.close().catch(() => undefined); sessions.dispose();
    await rm(base, { recursive: true, force: true });
    return;
  }
  const trap = createServer((socket) => { socket.on("error", () => undefined); socket.end("unexpected"); });
  const trap6 = createServer((socket) => { socket.on("error", () => undefined); socket.end("unexpected-v6"); });
  await new Promise<void>((resolve, reject) => { trap.once("error", reject); trap.listen(0, "127.0.0.1", () => { trap.off("error", reject); resolve(); }); });
  await new Promise<void>((resolve, reject) => { trap6.once("error", reject); trap6.listen(0, "::1", () => { trap6.off("error", reject); resolve(); }); });
  const trapAddress = trap.address();
  const trap6Address = trap6.address();
  if (!trapAddress || typeof trapAddress === "string" || !trap6Address || typeof trap6Address === "string") throw new Error("failed to allocate loopback trap ports");
  const oldAllowed = process.env.PET_ALLOWED_MARKER; const oldSecret = process.env.PET_SECRET_SENTINEL;
  process.env.PET_ALLOWED_MARKER = "visible"; process.env.PET_SECRET_SENTINEL = "MUST_NOT_LEAK";
  let sessionId: string | undefined;
  try {
    const session = await sessions.open("fixture", "HEAD", "brokered", "build"); sessionId = session.id;
    const allowed = await runner.exec(session.id, ["curl.exe", "--head", "--silent", "--show-error", "--ssl-revoke-best-effort", "--max-time", "8", "https://registry.npmjs.org/typescript"]);
    assert.equal(allowed.exitCode, 0, allowed.stderr || allowed.stdout);
    const denied = await runner.exec(session.id, ["curl.exe", "--head", "--silent", "--show-error", "--ssl-revoke-best-effort", "--max-time", "5", "https://example.com"]);
    assert.notEqual(denied.exitCode, 0, "unprofiled hostname unexpectedly escaped the broker");
    const script = "const n=require('node:net');const p=Number(process.argv.at(-1));let done=false;const finish=s=>{if(done)return;done=true;console.log('RESULT|'+(process.env.PET_ALLOWED_MARKER||'missing')+'|'+(process.env.PET_SECRET_SENTINEL||'clean')+'|'+s);process.exit(s==='direct-blocked'?0:3)};const x=n.connect(p,'127.0.0.1',()=>finish('direct-open'));x.on('error',()=>finish('direct-blocked'));x.setTimeout(1200,()=>{x.destroy();finish('direct-blocked')})";
    const raw = await runner.exec(session.id, ["node", "-e", script, String(trapAddress.port)]);
    assert.equal(raw.exitCode, 0, raw.stderr || raw.stdout);
    assert.match(raw.stdout, /RESULT\|visible\|clean\|direct-blocked/u);
    const script6 = script.replace("'127.0.0.1'", "'::1'");
    const raw6 = await runner.exec(session.id, ["node", "-e", script6, String(trap6Address.port)]);
    assert.equal(raw6.exitCode, 0, raw6.stderr || raw6.stdout);
    assert.match(raw6.stdout, /RESULT\|visible\|clean\|direct-blocked/u);
  } finally {
    if (oldAllowed === undefined) delete process.env.PET_ALLOWED_MARKER; else process.env.PET_ALLOWED_MARKER = oldAllowed;
    if (oldSecret === undefined) delete process.env.PET_SECRET_SENTINEL; else process.env.PET_SECRET_SENTINEL = oldSecret;
    if (sessionId) await sessions.close(sessionId, true).catch(() => undefined);
    await runner.close().catch(() => undefined); sessions.dispose();
    await Promise.all([
      new Promise<void>((resolve) => trap.close(() => resolve())),
      new Promise<void>((resolve) => trap6.close(() => resolve())),
    ]);
    await rm(base, { recursive: true, force: true });
  }
});
