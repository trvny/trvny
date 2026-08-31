import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

  const gitWhere = await execFileAsync(process.platform === "win32" ? "where.exe" : "which", ["git"]);
  const gitRoot = dirname(gitWhere.stdout.split(/\r?\n/u)[0] ?? "");
  const config: DispatcherConfig = {
    workspaceRoot,
    repositories: { fixture: repo },
    toolRoots: [gitRoot],
    networkProfiles: { github: { hosts: ["api.github.com"] } },
    defaultTimeoutMs: 15_000,
    maxOutputBytes: 1_048_576,
    maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free",
    geminiModel: "gemini-2.5-flash",
  };
  const sessions = new SessionManager(config);
  const runner = await CommandRunner.create(config, sessions);
  return { base, repo, workspaceRoot, sessions, runner };
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


test("host operations cannot race an active sandbox process", async () => {
  const fixture = await makeFixture();
  const session = await fixture.sessions.open("fixture");
  try {
    const running = fixture.runner.exec(session.id, ["cmd", "/d", "/s", "/c", "for /L %i in (1,1,2147483647) do @rem"], ".", 35_000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await assert.rejects(
      fixture.sessions.runHostOperation(session.id, async () => "unexpected"),
      /active workspace\.exec operation/,
    );
    assert.equal(fixture.runner.cancel(session.id), true);
    await running;
  } finally {
    await fixture.sessions.close(session.id, true);
    await rm(fixture.base, { recursive: true, force: true });
  }
});


test("cancel keeps the session occupied until the old child actually closes", async () => {
  const fixture = await makeFixture();
  const session = await fixture.sessions.open("fixture");
  try {
    const running = fixture.runner.exec(session.id, ["cmd", "/d", "/s", "/c", "for /L %i in (1,1,2147483647) do @rem"], ".", 35_000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(fixture.runner.cancel(session.id), true);
    const second = fixture.runner.exec(session.id, ["cmd", "/d", "/s", "/c", "echo SECOND"]);
    const secondResult = await second.then((value) => ({ kind: "value" as const, value }), (error) => ({ kind: "error" as const, error }));
    await running;
    if (secondResult.kind === "error") {
      assert.match(String(secondResult.error), /active workspace\.exec operation|running command/);
    } else {
      assert.equal(secondResult.value.exitCode, 0);
    }
    const after = await fixture.runner.exec(session.id, ["cmd", "/d", "/s", "/c", "echo AFTER"]);
    assert.equal(after.exitCode, 0);
    assert.match(after.stdout, /AFTER/);
  } finally {
    await fixture.sessions.close(session.id, true);
    await rm(fixture.base, { recursive: true, force: true });
  }
});

test("session sync fails closed until restricted host egress exists", async () => {
  const fixture = await makeFixture();
  try {
    await assert.rejects(
      fixture.sessions.open("fixture", "HEAD", "none", undefined, true),
      /sync requires restricted host egress/,
    );
  } finally { await rm(fixture.base, { recursive: true, force: true }); }
});

test("session checkout ignores inherited host Git filter configuration", async () => {
  const fixture = await makeFixture();
  const globalConfig = join(fixture.base, "host-global.gitconfig");
  await writeFile(join(fixture.repo, ".gitattributes"), "README.md filter=probe\n");
  await execFileAsync("git", ["-C", fixture.repo, "add", ".gitattributes"]);
  await execFileAsync("git", ["-C", fixture.repo, "-c", "user.name=Pet Test", "-c", "user.email=pet@example.invalid", "commit", "-m", "attrs"]);
  await execFileAsync("git", ["config", "--file", globalConfig, "filter.probe.smudge", "exit 79"]);
  await execFileAsync("git", ["config", "--file", globalConfig, "filter.probe.required", "true"]);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = globalConfig;
  try {
    const session = await fixture.sessions.open("fixture");
    await fixture.sessions.close(session.id, true);
  } finally {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = previous;
    await rm(fixture.base, { recursive: true, force: true });
  }
});


test("sandbox commands do not inherit dispatcher environment variables", async () => {
  const fixture = await makeFixture();
  const session = await fixture.sessions.open("fixture");
  const previous = process.env.PET_SECRET_SENTINEL;
  process.env.PET_SECRET_SENTINEL = "MUST_NOT_LEAK";
  try {
    const result = await fixture.runner.exec(session.id, ["cmd", "/d", "/s", "/c", "set PET_SECRET_SENTINEL"]);
    assert.doesNotMatch(result.stdout, /MUST_NOT_LEAK/);
    assert.match(result.stderr, /not defined/i);
  } finally {
    if (previous === undefined) delete process.env.PET_SECRET_SENTINEL; else process.env.PET_SECRET_SENTINEL = previous;
    await fixture.sessions.close(session.id, true);
    await rm(fixture.base, { recursive: true, force: true });
  }
});
