import assert from "node:assert/strict";
import test from "node:test";
import { AuthorityPolicy, authorityConfigSchema } from "../src/authority.js";
import type { DispatcherConfig } from "../src/config.js";
import { hostTaskHiddenFrom, mayHandleHostTask, mayIndexTask, taskVisibleTo } from "../control-plane/host-access.js";
import { mcpRoute } from "../control-plane/mcp-auth.js";
import { ConfinedRemoteExecutor } from "../src/remote-executor.js";
import {
  buildHostFsTask, hostFsCallSchema, remoteTaskSchema, signEnvelope, taskEnvelopeSchema, verifyEnvelope, type TaskEnvelope,
} from "../src/remote-protocol.js";

const ENV = { CONTROL_PLANE_TOKEN: "owner-secret-token", MCP_CONNECTOR_TOKEN: "connector-secret-token" };
const SIGNING_SECRET = "test-signing-secret-at-least-32-characters-long";
const call = hostFsCallSchema.parse({ ops: [{ op: "read", path: "C:\\work\\a.txt" }] });

test("the MCP route says which credential was used", () => {
  const owner = new Request("https://pet.example/mcp", { method: "POST", headers: { authorization: `Bearer ${ENV.CONTROL_PLANE_TOKEN}` } });
  const connector = new Request(`https://pet.example/mcp/${ENV.MCP_CONNECTOR_TOKEN}`, { method: "POST" });
  assert.equal(mcpRoute(owner, ENV), "owner");
  assert.equal(mcpRoute(connector, ENV), "connector");
  assert.equal(mcpRoute(new Request("https://pet.example/mcp", { method: "POST" }), ENV), null);
  assert.equal(mcpRoute(new Request("https://pet.example/mcp", { method: "POST", headers: { authorization: "Bearer wrong" } }), ENV), null);
  assert.equal(mcpRoute(new Request("https://pet.example/mcp/wrong", { method: "POST" }), ENV), null);
  // The owner bearer is only honoured on the plain path; a URL token is never owner-level.
  const bearerOnUrl = new Request(`https://pet.example/mcp/${ENV.MCP_CONNECTOR_TOKEN}`, { method: "POST", headers: { authorization: `Bearer ${ENV.CONTROL_PLANE_TOKEN}` } });
  assert.equal(mcpRoute(bearerOnUrl, ENV), "connector");
  assert.equal(mcpRoute(owner, {}), null);
});

test("host tasks are owner-only end to end and never indexed", () => {
  assert.equal(mayHandleHostTask("owner"), true);
  assert.equal(mayHandleHostTask("connector"), false);
  assert.equal(mayHandleHostTask(undefined), false, "service bindings and unknown callers");
  assert.equal(taskVisibleTo(true, "owner"), true);
  assert.equal(taskVisibleTo(true, "connector"), false);
  assert.equal(taskVisibleTo(true, undefined), false);
  assert.equal(taskVisibleTo(false, "connector"), true, "ordinary tasks stay visible");
  assert.equal(mayIndexTask(true), false);
  assert.equal(mayIndexTask(false), true);
});

test("a host task has one exact shape", () => {
  const ok = buildHostFsTask(call);
  assert.equal(ok.target, "host");
  assert.deepEqual(ok.capabilities, ["host.fs.read"]);
  const base = { target: "host", hostFs: call, executor: "direct", profile: "inspect", capabilities: ["host.fs.read"], network: { mode: "none" }, timeoutMinutes: 2 };
  assert.doesNotThrow(() => remoteTaskSchema.parse(base));
  for (const [label, patch] of Object.entries({
    "no host target": { target: undefined },
    "with a repo": { repo: "trvny" },
    "agent executor": { executor: "openrouter" },
    "code profile": { profile: "code" },
    "extra capability": { capabilities: ["host.fs.read", "workspace.read"] },
    "write capability": { capabilities: ["host.fs.write"] },
    "no capability": { capabilities: [] },
    "network": { network: { mode: "brokered", profile: "build" } },
    "long timeout": { timeoutMinutes: 20 },
    "direct call": { direct: { tool: "fs.read", path: "a" } },
    "goal": { goal: "x" },
  })) assert.throws(() => remoteTaskSchema.parse({ ...base, ...patch }), /./u, label);
  // host capabilities stay unusable anywhere else
  assert.throws(() => remoteTaskSchema.parse({ repo: "r", executor: "direct", direct: { tool: "fs.read", path: "a" }, profile: "inspect", capabilities: ["host.fs.read"] }));
});

test("host.fs operations are bounded and typed", () => {
  assert.throws(() => hostFsCallSchema.parse({ ops: [] }));
  assert.throws(() => hostFsCallSchema.parse({ ops: Array.from({ length: 17 }, () => ({ op: "stat", path: "C:\\a" })) }));
  assert.throws(() => hostFsCallSchema.parse({ ops: [{ op: "write", path: "C:\\a", content: "x" }] }), /./u, "write is not an op yet");
  assert.throws(() => hostFsCallSchema.parse({ ops: [{ op: "read", path: "" }] }));
  assert.throws(() => hostFsCallSchema.parse({ ops: [{ op: "read", path: "C:\\a", maxBytes: 70_000 }] }));
  assert.throws(() => hostFsCallSchema.parse({ ops: [{ op: "stat", path: "C:\\a", extra: 1 }] }));
});

test("the route is part of the signed envelope, and old envelopes stay valid", async () => {
  const task = buildHostFsTask(call);
  const now = Date.now();
  const envelope: TaskEnvelope = {
    version: 1, taskId: "11111111-1111-4111-8111-111111111111", deviceId: "legion", nonce: "22222222-2222-4222-8222-222222222222",
    issuedAt: now, expiresAt: now + 60_000, task, route: "owner",
  };
  const signed = await signEnvelope(envelope, SIGNING_SECRET);
  assert.equal(taskEnvelopeSchema.parse(signed.envelope).route, "owner");
  assert.equal(await verifyEnvelope(signed, SIGNING_SECRET), true);
  assert.equal(await verifyEnvelope({ ...signed, envelope: { ...signed.envelope, route: "connector" } }, SIGNING_SECRET), false, "flipping the route breaks the signature");
  const { route: _route, ...withoutRoute } = envelope;
  assert.equal(taskEnvelopeSchema.parse(withoutRoute).route, undefined, "ordinary tasks carry no route");
});

function executor(authority?: AuthorityPolicy) {
  const config = { workspaceRoot: "C:\\w", repositories: {}, workspaces: {}, toolRoots: [] } as unknown as DispatcherConfig;
  return new ConfinedRemoteExecutor(config, {} as never, {} as never, undefined, undefined, authority);
}

test("the Legion refuses a host task unless route, allowlist and authority all agree", async () => {
  const task = buildHostFsTask(call);
  const on = await AuthorityPolicy.create(authorityConfigSchema.parse({ grantable: ["host.fs.read"], roots: ["C:\\work"] }), { home: "C:\\Users\\t", canonicalize: async (p) => p });
  const off = await AuthorityPolicy.create(undefined, { home: "C:\\Users\\t", canonicalize: async (p) => p });
  const refused = async (exec: ConfinedRemoteExecutor, route: "owner" | "connector" | undefined) => {
    const result = await exec.execute(task, "t1", undefined, { route });
    assert.equal(result.status, "failed");
    return String(result.error);
  };
  assert.match(await refused(executor(), "owner"), /not enabled/u, "no authority configured");
  assert.match(await refused(executor(off), "owner"), /not enabled/u, "host mode off");
  assert.match(await refused(executor(on), "connector"), /may not use/u, "connector route");
  assert.match(await refused(executor(on), undefined), /may not use/u, "route missing from the envelope");
});

test("a non-owner never sees a task whose host flag cannot be read (fail closed)", async () => {
  assert.equal(await hostTaskHiddenFrom("owner", async () => { throw new Error("DO down"); }), false, "the owner is never hidden from");
  assert.equal(await hostTaskHiddenFrom("connector", async () => true), true);
  assert.equal(await hostTaskHiddenFrom("connector", async () => false), false, "ordinary tasks stay visible");
  assert.equal(await hostTaskHiddenFrom("connector", async () => undefined), true, "non-OK response");
  assert.equal(await hostTaskHiddenFrom("connector", async () => { throw new Error("DO down"); }), true, "thrown fetch");
  assert.equal(await hostTaskHiddenFrom(undefined, async () => undefined), true, "service binding with an unreadable flag");
});
