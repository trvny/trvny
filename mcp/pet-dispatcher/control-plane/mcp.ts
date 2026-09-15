import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { remoteDirectCallSchema } from "../src/remote-protocol.js";

export interface ControlRpcResult {
  status: number;
  body: unknown;
}

export interface ControlMcpOperations {
  meta(): Promise<ControlRpcResult>;
  delegate(task: unknown, idempotencyKey?: string): Promise<ControlRpcResult>;
  direct(value: unknown, idempotencyKey?: string): Promise<ControlRpcResult>;
  getTask(taskId: string): Promise<ControlRpcResult>;
  cancelTask(taskId: string): Promise<ControlRpcResult>;
}

const delegateInputSchema = z.object({
  repo: z.string().min(1).max(128),
  baseRef: z.string().min(1).max(256).default("main"),
  goal: z.string().min(1).max(20_000),
  executor: z.enum(["openrouter", "gemini"]).default("openrouter"),
  profile: z.enum(["inspect", "code"]).default("code"),
  timeoutMinutes: z.number().int().min(1).max(20).default(20),
  idempotencyKey: z.string().min(1).max(200).optional(),
  waitSeconds: z.number().int().min(0).max(45).default(20),
}).strict();
const directInputSchema = z.object({
  repo: z.string().min(1).max(128),
  baseRef: z.string().min(1).max(256).default("main"),
  call: remoteDirectCallSchema,
  idempotencyKey: z.string().min(1).max(200).optional(),
  waitSeconds: z.number().int().min(0).max(45).default(20),
}).strict();

function terminalBody(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const status = (body as { status?: unknown }).status;
  return status === "completed" || status === "failed" || status === "cancelled" || status === "recovery_required";
}

function taskIdFrom(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const taskId = (body as { taskId?: unknown }).taskId;
  return typeof taskId === "string" ? taskId : undefined;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function scopedIdempotencyKey(kind: "delegate" | "direct", key: string, value: unknown): Promise<string> {
  const material = new TextEncoder().encode(`${kind}\0${key}\0${JSON.stringify(value)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `mcp:${kind}:${hex}`;
}

async function awaitTask(
  operations: ControlMcpOperations,
  initial: ControlRpcResult,
  waitSeconds: number,
): Promise<ControlRpcResult> {
  if (initial.status >= 400 || waitSeconds <= 0 || terminalBody(initial.body)) return initial;
  const taskId = taskIdFrom(initial.body);
  if (!taskId) return initial;
  const deadline = Date.now() + waitSeconds * 1_000;
  let current = initial;
  while (Date.now() < deadline) {
    current = await operations.getTask(taskId);
    if (current.status >= 400 || terminalBody(current.body)) return current;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(1_000, remaining));
  }
  return current;
}

function asToolResult(result: ControlRpcResult) {
  const structured = { httpStatus: result.status, body: result.body };
  const bodyStatus = result.body && typeof result.body === "object"
    ? (result.body as { status?: unknown }).status : undefined;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
    isError: result.status >= 400 || bodyStatus === "failed" || bodyStatus === "recovery_required",
  };
}

function createServer(operations: ControlMcpOperations): McpServer {
  const server = new McpServer({ name: "pet-dispatcher-control", version: "1.0.0" }, {
    instructions: "Dispatch confined work to the paired machine. Calls may queue briefly while the device polls for work.",
  });
  server.registerTool("pet_meta", {
    description: "Report the paired Pet Dispatcher device and its remote capabilities.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => asToolResult(await operations.meta()));

  server.registerTool("pet_delegate", {
    description: "Run a confined coding or inspection agent task on the paired machine.",
    inputSchema: delegateInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ repo, baseRef, goal, executor, profile, timeoutMinutes, idempotencyKey, waitSeconds }) => {
    const task = {
      repo, baseRef, goal, executor, profile,
      capabilities: [],
      network: { mode: "none" },
      timeoutMinutes,
    };
    const stableKey = idempotencyKey ? await scopedIdempotencyKey("delegate", idempotencyKey, task) : undefined;
    const submitted = await operations.delegate(task, stableKey);
    return asToolResult(await awaitTask(operations, submitted, waitSeconds));
  });

  server.registerTool("pet_direct", {
    description: "Run one confined filesystem, Git, session or process tool call on the paired machine.",
    inputSchema: directInputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ repo, baseRef, call, idempotencyKey, waitSeconds }) => {
    const value = { repo, baseRef, call };
    const stableKey = idempotencyKey ? await scopedIdempotencyKey("direct", idempotencyKey, value) : undefined;
    const submitted = await operations.direct(value, stableKey);
    return asToolResult(await awaitTask(operations, submitted, waitSeconds));
  });
  server.registerTool("pet_task_get", {
    description: "Read the current state and bounded result of a Pet Dispatcher task.",
    inputSchema: z.object({ taskId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ taskId }) => asToolResult(await operations.getTask(taskId)));

  server.registerTool("pet_task_cancel", {
    description: "Request cancellation of a queued or running Pet Dispatcher task.",
    inputSchema: z.object({ taskId: z.string().uuid() }).strict(),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ taskId }) => asToolResult(await operations.cancelTask(taskId)));

  return server;
}

export async function handleControlMcp(request: Request, operations: ControlMcpOperations): Promise<Response> {
  const server = createServer(operations);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => undefined);
  }
}
