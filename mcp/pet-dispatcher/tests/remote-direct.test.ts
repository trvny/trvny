import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { DispatcherConfig } from "../src/config.js";
import { ConfinedRemoteExecutor } from "../src/remote-executor.js";
import { remoteTaskSchema } from "../src/remote-protocol.js";
import { SessionManager } from "../src/sessions.js";

const execFileAsync = promisify(execFile);

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "pet-direct-"));
  const repo = join(base, "repo");
  await mkdir(repo);
  await execFileAsync("git", ["init", repo]);
  await writeFile(join(repo, "README.md"), "# direct bridge\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md"]);
  await execFileAsync("git", ["-C", repo, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "-c", "commit.gpgSign=false", "commit", "-m", "init"]);
  const gitWhere = await execFileAsync(process.platform === "win32" ? "where.exe" : "which", ["git"]);
  const gitRoot = dirname(gitWhere.stdout.split(/\r?\n/u)[0] ?? "");
  const config = {
    workspaceRoot: join(base, "worker"), repositories: { fixture: repo }, toolRoots: [gitRoot], networkProfiles: {},
    defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  } satisfies DispatcherConfig;
  return { base, config, sessions: new SessionManager(config) };
}

test("direct remote fs.read uses an isolated session and returns bounded output", async () => {
  const state = await fixture();
  const executor = new ConfinedRemoteExecutor(state.config, state.sessions, {} as never);
  const task = remoteTaskSchema.parse({
    repo: "fixture", baseRef: "HEAD", executor: "direct", profile: "inspect",
    capabilities: ["workspace.read", "git.read"], network: { mode: "none" }, timeoutMinutes: 2,
    direct: { tool: "fs.read", path: "README.md" },
  });
  try {
    const result = await executor.execute(task, "direct-test");
    assert.equal(result.status, "completed");
    const output = JSON.parse(result.output ?? "{}") as { content?: string };
    assert.equal(output.content, "# direct bridge\n");
    assert.equal(state.sessions.list().length, 0);
  } finally {
    for (const session of state.sessions.list()) {
      await state.sessions.close(session.id, true).catch(() => undefined);
    }
    await rm(state.base, { recursive: true, force: true });
  }
});
