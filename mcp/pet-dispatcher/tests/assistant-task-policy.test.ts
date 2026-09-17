import assert from "node:assert/strict";
import test from "node:test";
import { assertAssistantTaskAllowed, remoteTaskSchema } from "../src/remote-protocol.js";

function agentTask(overrides: Record<string, unknown> = {}) {
  return remoteTaskSchema.parse({
    repo: "trvny", baseRef: "main", goal: "inspect the repo", executor: "openrouter",
    profile: "inspect", capabilities: [], network: { mode: "none" }, timeoutMinutes: 5,
    ...overrides,
  });
}

function directTask(tool: string, extra: Record<string, unknown> = {}) {
  return remoteTaskSchema.parse({
    repo: "legion", baseRef: "main", executor: "direct", profile: "inspect",
    capabilities: ["workspace.read", "git.read"], network: { mode: "none" }, timeoutMinutes: 2,
    direct: { tool, ...extra },
  });
}

test("allows an ordinary inspect/code agent-goal task with no extra scope", () => {
  assert.doesNotThrow(() => assertAssistantTaskAllowed(agentTask()));
  assert.doesNotThrow(() => assertAssistantTaskAllowed(agentTask({ profile: "code", goal: "fix the bug" })));
});

test("rejects an agent task that requests capabilities or network access", () => {
  assert.throws(
    () => assertAssistantTaskAllowed(agentTask({ capabilities: ["workspace.read"] })),
    /assistant_task_scope_forbidden/u,
  );
  assert.throws(
    () => assertAssistantTaskAllowed(agentTask({ network: { mode: "brokered", profile: "build" } })),
    /assistant_task_scope_forbidden/u,
  );
});

test("allows the system.status probe despite being a direct executor call", () => {
  assert.doesNotThrow(() => assertAssistantTaskAllowed(directTask("system.status")));
});

test("rejects every other direct tool, including read-only ones", () => {
  assert.throws(
    () => assertAssistantTaskAllowed(directTask("session.list")),
    /assistant_task_profile_forbidden/u,
  );
  assert.throws(
    () => assertAssistantTaskAllowed(directTask("fs.read", { path: "README.md" })),
    /assistant_task_profile_forbidden/u,
  );
});
