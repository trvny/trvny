import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";
import { findCommandOnPath } from "../src/agent-router.js";
import type { DispatcherConfig } from "../src/config.js";
import { resolveTrustedGitExecutable } from "../src/git-runtime.js";
import { discoveredToolGrantRoot } from "../src/sandbox.js";

function configWithoutToolRoots(): DispatcherConfig {
  return {
    workspaceRoot: tmpdir(), repositories: {}, workspaces: {}, toolRoots: [], networkProfiles: {},
    defaultTimeoutMs: 15_000, maxOutputBytes: 1_048_576, maxBrokerResponseBytes: 2_097_152,
    openRouterModel: "openrouter/free", geminiModel: "gemini-2.5-flash",
  };
}

test("host Git falls back to the same canonical PATH discovery used by tool probes", async () => {
  const expected = await findCommandOnPath("git");
  assert.ok(expected, "CI must have Git on PATH");
  assert.equal(await resolveTrustedGitExecutable(configWithoutToolRoots()), expected);
});

test("Scoop PATH tools grant only their versioned app root", () => {
  assert.equal(discoveredToolGrantRoot("C:\\Users\\me\\scoop\\apps\\git\\2.55.0.5\\cmd\\git.exe", "win32"), "C:\\Users\\me\\scoop\\apps\\git\\2.55.0.5");
});
