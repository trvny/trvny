import assert from "node:assert/strict";
import test from "node:test";
import { AgentTools, agentToolDefinitions } from "../src/agent-tools.js";
import type { HostGit } from "../src/host-git.js";
import type { NetworkBroker } from "../src/network.js";
import type { CommandRunner } from "../src/sandbox.js";
import type { Session, SessionManager } from "../src/sessions.js";

const session: Session = {
  id: "00000000-0000-4000-8000-000000000002",
  repo: "fixture",
  sessionDir: "C:\\worker\\session",
  root: "C:\\worker\\session\\worktree",
  gitDir: "C:\\worker\\session\\git",
  sourceRoot: "C:\\repo",
  initialCommit: "deadbeef",
  readonlyRoots: [],
  network: { mode: "none", profile: null },
  exportedCommit: null,
  exportedRef: null,
  createdAt: new Date(0).toISOString(),
};
test("agent exec rejects invalid timeout values before reaching the runner", async () => {
  let runnerCalled = false;
  const sessions = {
    get: () => session,
    runHostOperation: <T>(_id: string, operation: (locked: Session) => Promise<T>) => operation(session),
  } as unknown as SessionManager;
  const runner = {
    exec: () => { runnerCalled = true; return Promise.resolve({}); },
  } as unknown as CommandRunner;
  const tools = new AgentTools(
    sessions,
    runner,
    {} as NetworkBroker,
    {} as HostGit,
  );

  await assert.rejects(
    tools.execute(session.id, "exec", { argv: ["cmd"], timeoutMs: -1 }),
    /integer between 1000 and 3600000/,
  );
  assert.equal(runnerCalled, false);
});


test("provider agents cannot export commits into the host source repository", () => {
  assert.equal(agentToolDefinitions.some((tool) => tool.name === "git_export"), false);
});
