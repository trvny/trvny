import assert from "node:assert/strict";
import test from "node:test";
import { handleControlMcp, type ControlMcpOperations } from "../control-plane/mcp.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

function request(body: unknown): Request {
  return new Request("https://pet.example/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function rpc(operations: ControlMcpOperations, body: unknown) {
  const response = await handleControlMcp(request(body), operations);
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) as Record<string, unknown> : undefined };
}

function baseOperations(overrides: Partial<ControlMcpOperations> = {}): ControlMcpOperations {
  return {
    meta: async () => ({ status: 200, body: { deviceId: "test-device", transport: "cloudflare-queues-http-pull", protocol: 1, directTools: ["fs.read"] } }),
    delegate: async () => ({ status: 202, body: { taskId: TASK_ID, status: "queued" } }),
    direct: async () => ({ status: 202, body: { taskId: TASK_ID, status: "queued" } }),
    getTask: async () => ({ status: 200, body: { taskId: TASK_ID, status: "running" } }),
    cancelTask: async () => ({ status: 200, body: { taskId: TASK_ID, status: "cancel_requested" } }),
    ...overrides,
  };
}
async function initialize(operations: ControlMcpOperations): Promise<void> {
  const result = await rpc(operations, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "pet-test", version: "1" },
    },
  });
  assert.equal(result.response.status, 200);
  const info = (result.body?.result as { serverInfo?: { name?: string; title?: string; description?: string; icons?: Array<{ src?: string }> } })?.serverInfo;
  assert.equal(info?.name, "pet-dispatcher-control");
  assert.equal(info?.title, "Pet Dispatcher");
  assert.match(info?.description ?? "", /remote bridge/u);
  assert.equal(info?.icons?.[0]?.src, "https://pet-dispatcher-control.travny.workers.dev/icon.png");
}

test("remote MCP exposes the control-plane task surface", async () => {
  const operations = baseOperations();
  await initialize(operations);
  const listed = await rpc(operations, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  assert.equal(listed.response.status, 200);
  const listedTools = ((listed.body?.result as { tools?: Array<{ name: string; outputSchema?: unknown }> })?.tools ?? []);
  const tools = listedTools.map(({ name }) => name);
  assert.deepEqual(tools.sort(), [
    "pet_delegate", "pet_direct", "pet_meta", "pet_task_cancel", "pet_task_get",
  ]);
  assert.ok(listedTools.every((tool) => tool.outputSchema));

  const meta = await rpc(operations, {
    jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "pet_meta", arguments: {} },
  });
  assert.equal(meta.response.status, 200);
  const result = meta.body?.result as { structuredContent?: { body?: { deviceId?: string } } };
  assert.equal(result.structuredContent?.body?.deviceId, "test-device");
});
test("remote MCP delegates through the existing assistant guard shape", async () => {
  let delegated: unknown;
  let key: string | undefined;
  const operations = baseOperations({
    delegate: async (task, idempotencyKey) => {
      delegated = task;
      key = idempotencyKey;
      return { status: 202, body: { taskId: TASK_ID, status: "queued" } };
    },
  });
  const result = await rpc(operations, {
    jsonrpc: "2.0", id: 4, method: "tools/call", params: {
      name: "pet_delegate",
      arguments: {
        repo: "trvny", goal: "inspect status", profile: "inspect",
        idempotencyKey: "delegate-once", waitSeconds: 0,
      },
    },
  });
  assert.equal(result.response.status, 200);
  assert.match(key ?? "", /^mcp:delegate:[0-9a-f]{64}$/u);
  assert.equal(key?.includes("delegate-once"), false);
  assert.deepEqual(delegated, {
    repo: "trvny", baseRef: "main", goal: "inspect status", executor: "openrouter",
    profile: "inspect", capabilities: [], network: { mode: "none" }, timeoutMinutes: 20,
  });
});

test("remote MCP forwards direct calls without widening their contract", async () => {
  let direct: unknown;
  const operations = baseOperations({
    direct: async (value) => {
      direct = value;
      return { status: 202, body: { taskId: TASK_ID, status: "queued" } };
    },
  });
  const result = await rpc(operations, {
    jsonrpc: "2.0", id: 5, method: "tools/call", params: {
      name: "pet_direct",
      arguments: {
        repo: "trvny", waitSeconds: 0,
        call: { tool: "fs.read", path: "README.md" },
      },
    },
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(direct, {
    repo: "trvny", baseRef: "main", call: { tool: "fs.read", path: "README.md" },
  });
});

test("remote MCP waits briefly for a terminal task result", async () => {
  let polls = 0;
  const operations = baseOperations({
    getTask: async () => {
      polls += 1;
      return {
        status: 200,
        body: { taskId: TASK_ID, status: "completed", result: { status: "completed", summary: "done" } },
      };
    },
  });
  const result = await rpc(operations, {
    jsonrpc: "2.0", id: 6, method: "tools/call", params: {
      name: "pet_delegate",
      arguments: { repo: "trvny", goal: "inspect", waitSeconds: 1 },
    },
  });
  assert.equal(result.response.status, 200);
  assert.equal(polls, 1);
  const call = result.body?.result as { structuredContent?: { body?: { status?: string } } };
  assert.equal(call.structuredContent?.body?.status, "completed");
});
