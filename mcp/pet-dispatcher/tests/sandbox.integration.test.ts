import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { DispatcherConfig } from "../src/config.js";
import { CommandRunner } from "../src/sandbox.js";
import { SessionManager } from "../src/sessions.js";

const execFileAsync = promisify(execFile);

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), "pet-dispatcher-sandbox-"));
  const repo = join(base, "repo");
  const workspaceRoot = join(base, "worker");
  await mkdir(repo);
  await mkdir(workspaceRoot);
  await execFileAsync("git", ["init", repo]);
  await writeFile(join(repo, "README.md"), "INSIDE_OK\n");
  await execFileAsync("git", ["-C", repo, "add", "README.md"]);
  await execFileAsync("git", ["-C", repo, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "init"]);
  await writeFile(join(workspaceRoot, "outside.txt"), "OUTSIDE_SECRET\n");

  const config: DispatcherConfig = {
    workspaceRoot,
    repositories: { fixture: repo },
    toolRoots: [],
    networkProfiles: { github: { hosts: ["api.github.com"] } },
    defaultTimeoutMs: 15_000,
    maxOutputBytes: 1_048_576,
    maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free",
    geminiModel: "gemini-2.5-flash",
  };
  const sessions = new SessionManager(config);
  const runner = await CommandRunner.create(config, sessions);
  return { base, workspaceRoot, sessions, runner };
}

test("MXC permits session files but denies files outside the assigned workspace", async () => {
  const fixture = await makeFixture();
  const session = await fixture.sessions.open("fixture");
  try {
    const inside = await fixture.runner.exec(session.id, ["cmd", "/d", "/s", "/c", "type README.md"]);
    assert.equal(inside.exitCode, 0);
    assert.match(inside.stdout, /INSIDE_OK/);

    const outside = await fixture.runner.exec(session.id, ["cmd", "/d", "/s", "/c", "type ..\\..\\outside.txt"]);
    assert.notEqual(outside.exitCode, 0);
    assert.doesNotMatch(outside.stdout, /OUTSIDE_SECRET/);
  } finally {
    await fixture.sessions.close(session.id, true);
    await rm(fixture.base, { recursive: true, force: true });
  }
});
test("brokered sessions still deny direct sandbox sockets", async () => {
  const fixture = await makeFixture();
  const session = await fixture.sessions.open("fixture", "HEAD", "brokered", "github");
  try {
    const result = await fixture.runner.exec(session.id, [
      "curl.exe", "--head", "--silent", "--show-error", "--max-time", "5", "https://api.github.com",
    ], ".", 10_000);
    assert.notEqual(result.exitCode, 0);
  } finally {
    await fixture.sessions.close(session.id, true);
    await rm(fixture.base, { recursive: true, force: true });
  }
});

test("restricted direct egress fails closed until a host enforcement backend exists", async () => {
  const fixture = await makeFixture();
  try {
    await assert.rejects(
      fixture.sessions.open("fixture", "HEAD", "restricted", "github"),
      /not available yet/,
    );
  } finally { await rm(fixture.base, { recursive: true, force: true }); }
});
test("one writer lease prevents a second writable session for the same repository", async () => {
  const fixture = await makeFixture();
  const session = await fixture.sessions.open("fixture");
  try {
    await assert.rejects(fixture.sessions.open("fixture"), /already has a writer session/);
  } finally {
    await fixture.sessions.close(session.id, true);
    await rm(fixture.base, { recursive: true, force: true });
  }
});

test("workspace cancellation terminates a long-running sandbox command", async () => {
  const fixture = await makeFixture();
  const session = await fixture.sessions.open("fixture");
  try {
    const running = fixture.runner.exec(session.id, ["cmd", "/d", "/s", "/c", "for /L %i in (1,1,2147483647) do @rem"] , ".", 35_000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(fixture.runner.cancel(session.id), true);
    const result = await running;
    assert.ok(result.durationMs < 5_000, `cancel took ${result.durationMs}ms`);
  } finally {
    await fixture.sessions.close(session.id, true);
    await rm(fixture.base, { recursive: true, force: true });
  }
});

test("concurrent opens reserve the writer lease before asynchronous setup", async () => {
  const fixture = await makeFixture();
  try {
    const results = await Promise.allSettled([
      fixture.sessions.open("fixture"),
      fixture.sessions.open("fixture"),
    ]);
    const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof fixture.sessions.open>>> => result.status === "fulfilled");
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(String(rejected[0]?.reason), /already has a writer session/);
    if (fulfilled[0]) await fixture.sessions.close(fulfilled[0].value.id, true);
  } finally { await rm(fixture.base, { recursive: true, force: true }); }
});
