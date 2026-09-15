import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { remoteDirectCallSchema, remoteResultSchema } from "../src/remote-protocol.js";

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
  repo: z.string().min(1).max(128).describe("Repository in owner/name form"),
  baseRef: z.string().min(1).max(256).default("main").describe("Git ref used as the isolated checkout base"),
  goal: z.string().min(1).max(20_000).describe("Concrete coding or inspection goal"),
  executor: z.enum(["openrouter", "gemini"]).default("openrouter").describe("Free routed agent backend"),
  profile: z.enum(["inspect", "code"]).default("code").describe("inspect for read-oriented work, code for changes"),
  timeoutMinutes: z.number().int().min(1).max(20).default(20).describe("Hard task timeout in minutes"),
  idempotencyKey: z.string().min(1).max(200).optional().describe("Optional retry key; same key and payload resolve to the same task"),
  waitSeconds: z.number().int().min(0).max(45).default(20).describe("How long to poll for a terminal result before returning a task snapshot"),
}).strict();
const directInputSchema = z.object({
  repo: z.string().min(1).max(128).describe("Repository in owner/name form"),
  baseRef: z.string().min(1).max(256).default("main").describe("Git ref used as the isolated checkout base"),
  call: remoteDirectCallSchema.describe("One confined direct filesystem, Git, session or process call"),
  idempotencyKey: z.string().min(1).max(200).optional().describe("Optional retry key; same key and payload resolve to the same task"),
  waitSeconds: z.number().int().min(0).max(45).default(20).describe("How long to poll for a terminal result before returning a task snapshot"),
}).strict();

const taskStatusSchema = z.enum([
  "queued", "leased", "running", "cancel_requested",
  "completed", "failed", "cancelled", "recovery_required",
]);
const taskBodySchema = z.object({
  taskId: z.string().uuid(),
  status: taskStatusSchema,
  deviceId: z.string().min(1).max(128).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  heartbeatAt: z.string().datetime().optional(),
  cancelRequested: z.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
  result: remoteResultSchema.optional(),
}).strict();
const metaOutputSchema = z.object({
  httpStatus: z.number().int().min(100).max(599),
  body: z.object({
    deviceId: z.string().min(1).max(128),
    transport: z.literal("cloudflare-queues-http-pull"),
    protocol: z.literal(1),
    directTools: z.array(z.string()),
  }).strict(),
}).strict();
const taskOutputSchema = z.object({
  httpStatus: z.number().int().min(100).max(599),
  body: taskBodySchema,
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
  const server = new McpServer({
    name: "pet-dispatcher-control",
    title: "Pet Dispatcher",
    version: "1.0.0",
    description: "Private remote bridge for confined coding, Git, filesystem and process tasks on a paired machine.",
    websiteUrl: "https://github.com/trvny/trvny/tree/main/mcp/pet-dispatcher",
    icons: [{ src: "https://pet-dispatcher-control.travny.workers.dev/icon.png", mimeType: "image/png", sizes: ["512x512"] }],
  }, {
    instructions: "Dispatch confined work to the paired machine. Prefer pet_meta before complex work; calls may queue briefly while the device polls for work.",
  });

  server.registerTool("pet_meta", {
    description: "Report the paired device, transport and direct-tool capabilities.",
    outputSchema: metaOutputSchema,
    annotations: { title: "Pet Dispatcher status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => asToolResult(await operations.meta()));

  server.registerTool("pet_delegate", {
    description: "Delegate a confined coding or inspection task to the paired machine. Returns a task snapshot or terminal result.",
    inputSchema: delegateInputSchema,
    outputSchema: taskOutputSchema,
    annotations: { title: "Delegate task", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ repo, baseRef, goal, executor, profile, timeoutMinutes, idempotencyKey, waitSeconds }) => {
    const task = { repo, baseRef, goal, executor, profile, capabilities: [], network: { mode: "none" }, timeoutMinutes };
    const stableKey = idempotencyKey ? await scopedIdempotencyKey("delegate", idempotencyKey, task) : undefined;
    const submitted = await operations.delegate(task, stableKey);
    return asToolResult(await awaitTask(operations, submitted, waitSeconds));
  });

  server.registerTool("pet_direct", {
    description: "Run one confined filesystem, Git, session or process call on the paired machine. Returns a task snapshot or terminal result.",
    inputSchema: directInputSchema,
    outputSchema: taskOutputSchema,
    annotations: { title: "Run direct tool", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ repo, baseRef, call, idempotencyKey, waitSeconds }) => {
    const value = { repo, baseRef, call };
    const stableKey = idempotencyKey ? await scopedIdempotencyKey("direct", idempotencyKey, value) : undefined;
    const submitted = await operations.direct(value, stableKey);
    return asToolResult(await awaitTask(operations, submitted, waitSeconds));
  });

  server.registerTool("pet_task_get", {
    description: "Read the current state and bounded result of a Pet Dispatcher task.",
    inputSchema: z.object({ taskId: z.string().uuid().describe("Task UUID returned by pet_delegate or pet_direct") }).strict(),
    outputSchema: taskOutputSchema,
    annotations: { title: "Get task state", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ taskId }) => asToolResult(await operations.getTask(taskId)));

  server.registerTool("pet_task_cancel", {
    description: "Request cancellation of a queued or running Pet Dispatcher task.",
    inputSchema: z.object({ taskId: z.string().uuid().describe("Task UUID returned by pet_delegate or pet_direct") }).strict(),
    outputSchema: taskOutputSchema,
    annotations: { title: "Cancel task", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
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
