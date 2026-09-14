import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import type { DispatcherConfig } from "../src/config.js";
import { ConfinedRemoteExecutor } from "../src/remote-executor.js";
import { remoteTaskSchema } from "../src/remote-protocol.js";
import { SessionManager } from "../src/sessions.js";

const execFileAsync = promisify(execFile);

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "pet-cleanup-retry-"));
  const repo = join(base, "repo");
  await mkdir(repo, { recursive: true });
  await execFileAsync("git", ["init", repo]);
  await writeFile(join(repo, "README.md"), "fixture\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md"]);
  await execFileAsync("git", ["-C", repo, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "init"]);
  const gitWhere = await execFileAsync(process.platform === "win32" ? "where.exe" : "which", ["git"]);
  const gitRoot = dirname(gitWhere.stdout.split(/\r?\n/u)[0] ?? "");
  const config = {
    workspaceRoot: join(base, "worker"), repositories: { fixture: repo }, toolRoots: [gitRoot], networkProfiles: {},
    defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  } satisfies DispatcherConfig;
  return { base, config, sessions: new SessionManager(config) };
}

test("provider failure finishes diagnostics before cleaning up the session", async () => {
  const state = await fixture();
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
  process.env.OPENROUTER_API_KEY = "test-only";
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  const task = remoteTaskSchema.parse({ repo: "fixture", baseRef: "HEAD", executor: "openrouter", profile: "inspect",
    capabilities: ["workspace.read", "git.read"], network: { mode: "none" }, timeoutMinutes: 2, goal: "inspect" });
  try {
    const result = await executor.execute(task, "cleanup-after-provider-failure");
    assert.equal(result.status, "failed");
    assert.equal(state.sessions.list().length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalKey;
    for (const session of state.sessions.list()) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try { await state.sessions.close(session.id, true); break; } catch { await delay(25); }
      }
    }
    await rm(state.base, { recursive: true, force: true }).catch(() => undefined);
  }
});
