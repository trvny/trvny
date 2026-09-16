import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const result = await runner.exec(session.id, [
      "node", "-e", "console.log('NODE_OK|' + (process.env.PET_SECRET_SENTINEL || 'clean'))",
    ]);
    assert.equal(result.exitCode, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /NODE_OK\|clean/u);
    assert.doesNotMatch(result.stdout, /MUST_NOT_LEAK/u);
  } finally {
    if (previous === undefined) delete process.env.PET_SECRET_SENTINEL;
    else process.env.PET_SECRET_SENTINEL = previous;
    if (sessionId) await sessions.close(sessionId, true).catch(() => undefined);
    await runner.close().catch(() => undefined);
    sessions.dispose();
    await rm(base, { recursive: true, force: true });
  }
});
