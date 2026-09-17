import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { REMOTE_DIRECT_TOOLS, remoteDirectCallSchema, remoteResultSchema } from "../src/remote-protocol.js";

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

const debugSchema = z.boolean().default(false).describe("Return full task metadata instead of the compact view");
const delegateInputSchema = z.object({
  repo: z.string().min(1).max(128).describe("Repository alias"),
  baseRef: z.string().min(1).max(256).default("main").describe("Git base ref"),
  goal: z.string().min(1).max(20_000).describe("Concrete coding or inspection goal"),
  executor: z.literal("openrouter").default("openrouter"),
  profile: z.enum(["inspect", "code"]).default("code"),
  timeoutMinutes: z.number().int().min(1).max(20).default(20),
  idempotencyKey: z.string().min(1).max(200).optional(),
  waitSeconds: z.number().int().min(0).max(45).default(20),
  debug: debugSchema,
}).strict();
const directToolSchema = z.enum(REMOTE_DIRECT_TOOLS);
const AUTO_SESSION_TOOLS = new Set([
  "fs.write", "fs.patch", "fs.mkdir", "fs.move", "fs.delete", "workspace.exec",
]);
const directInputSchema = z.object({
  target: z.string().min(1).max(128).describe("Repository or workspace alias"),
  tool: directToolSchema.describe("Confined direct tool"),
  args: z.record(z.string(), z.unknown()).default({}).describe("Arguments for the selected tool"),
  autoSession: z.boolean().default(true).describe("Auto-open a reusable write/exec session when no sessionId is supplied"),
  baseRef: z.string().min(1).max(256).default("main").describe("Git base ref when target is a repository"),
  idempotencyKey: z.string().min(1).max(200).optional(),
  waitSeconds: z.number().int().min(0).max(45).default(20),
  debug: debugSchema,
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
    deviceId: z.string().min(1).max(128), transport: z.literal("cloudflare-queues-http-pull"), protocol: z.literal(1),
    updatedAt: z.string().datetime().nullable(), repositories: z.array(z.string()), workspaces: z.array(z.string()),
    directTools: z.array(z.string()), localTools: z.array(z.string()), activeSessions: z.number().int().min(0),
    activeProcesses: z.number().int().min(0), stale: z.boolean(),
    sandbox: z.object({ supported: z.boolean(), processGuard: z.string(), networkDefault: z.string(), isolationTier: z.string().nullable().optional() }).passthrough(),
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

function compactTaskBody(body: unknown, debug: boolean): unknown {
  if (debug || !body || typeof body !== "object") return body;
  const task = body as Record<string, unknown>;
  if (typeof task.taskId !== "string" || typeof task.status !== "string") return body;
  const compact: Record<string, unknown> = { taskId: task.taskId, status: task.status };
  if (task.result !== undefined) compact.result = task.result;
  if (task.cancelRequested === true) compact.cancelRequested = true;
  return compact;
}

function shortText(result: ControlRpcResult, body: unknown): string {
  if (body && typeof body === "object") {
    const task = body as { status?: unknown; result?: unknown };
    if (task.result && typeof task.result === "object") {
      const summary = (task.result as { summary?: unknown }).summary;
      if (typeof summary === "string" && summary) return summary.slice(0, 1_000);
    }
    if (typeof task.status === "string") return `Pet Dispatcher task: ${task.status}.`;
  }
  return result.status >= 400 ? `Pet Dispatcher request failed with HTTP ${result.status}.` : "Pet Dispatcher request completed.";
}

function asToolResult(result: ControlRpcResult, debug = false) {
  const body = compactTaskBody(result.body, debug);
  const structured = { httpStatus: result.status, body };
  const bodyStatus = body && typeof body === "object" ? (body as { status?: unknown }).status : undefined;
  return {
    content: [{ type: "text" as const, text: shortText(result, body) }],
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
    instructions: "Dispatch confined work to the paired machine. State-changing direct calls auto-open a short-lived session; finish it with session.finish.",
  });

  server.registerTool("pet_meta", {
    description: "Compact capability dashboard for the paired device: target aliases, direct tools, local tools, active work and sandbox status.",
    outputSchema: metaOutputSchema,
    annotations: { title: "Pet Dispatcher status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => asToolResult(await operations.meta(), true));

  server.registerTool("pet_delegate", {
    description: "Delegate a confined coding or inspection task to the paired machine.",
    inputSchema: delegateInputSchema,
    outputSchema: taskOutputSchema,
    annotations: { title: "Delegate task", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ repo, baseRef, goal, executor, profile, timeoutMinutes, idempotencyKey, waitSeconds, debug }) => {
    const task = { repo, baseRef, goal, executor, profile, capabilities: [], network: { mode: "none" }, timeoutMinutes };
    const stableKey = idempotencyKey ? await scopedIdempotencyKey("delegate", idempotencyKey, task) : undefined;
    const submitted = await operations.delegate(task, stableKey);
    return asToolResult(await awaitTask(operations, submitted, waitSeconds), debug);
  });

  server.registerTool("pet_direct", {
    description: "Run one confined direct tool. Write/exec calls auto-open a reusable session by default; use session.finish to commit/export/close it.",
    inputSchema: directInputSchema,
    outputSchema: taskOutputSchema,
    annotations: { title: "Run direct tool", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ target, tool, args, autoSession, baseRef, idempotencyKey, waitSeconds, debug }) => {
    const callArgs: Record<string, unknown> = { ...args };
    if (AUTO_SESSION_TOOLS.has(tool) && !("sessionId" in callArgs) && !("autoSession" in callArgs)) callArgs.autoSession = autoSession;
    const call = remoteDirectCallSchema.parse({ ...callArgs, tool });
    const value = { repo: target, baseRef, call };
    const stableKey = idempotencyKey ? await scopedIdempotencyKey("direct", idempotencyKey, value) : undefined;
    const submitted = await operations.direct(value, stableKey);
    return asToolResult(await awaitTask(operations, submitted, waitSeconds), debug);
  });

  server.registerTool("pet_task_get", {
    description: "Read the current state and bounded result of a Pet Dispatcher task.",
    inputSchema: z.object({ taskId: z.string().uuid(), debug: debugSchema }).strict(),
    outputSchema: taskOutputSchema,
    annotations: { title: "Get task state", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ taskId, debug }) => asToolResult(await operations.getTask(taskId), debug));

  server.registerTool("pet_task_cancel", {
    description: "Request cancellation of a queued or running Pet Dispatcher task.",
    inputSchema: z.object({ taskId: z.string().uuid() }).strict(),
    outputSchema: taskOutputSchema,
    annotations: { title: "Cancel task", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ taskId }) => asToolResult(await operations.cancelTask(taskId)));

  return server;
}
function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function normalizeLegacyDirectRpc(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const normalized = normalizeLegacyDirectRpc(item);
      if (normalized !== item) changed = true;
      return normalized;
    });
    return changed ? items : value;
  }
  const rpc = recordOf(value);
  const params = recordOf(rpc?.params);
  const args = recordOf(params?.arguments);
  const call = recordOf(args?.call);
  if (!rpc || rpc.method !== "tools/call" || params?.name !== "pet_direct" || !args || !call) return value;
  if (typeof args.repo !== "string" || typeof call.tool !== "string" || "target" in args || "tool" in args) return value;
  const { repo, call: _legacyCall, ...rest } = args;
  const { tool, ...callArgs } = call;
  return { ...rpc, params: { ...params, arguments: { ...rest, target: repo, tool, args: callArgs } } };
}

async function normalizeLegacyDirectRequest(request: Request): Promise<Request> {
  if (request.method !== "POST") return request;
  let body: unknown;
  try { body = await request.clone().json(); }
  catch { return request; }
  const normalized = normalizeLegacyDirectRpc(body);
  if (normalized === body) return request;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request, { headers, body: JSON.stringify(normalized) });
}

export async function handleControlMcp(request: Request, operations: ControlMcpOperations): Promise<Response> {
  request = await normalizeLegacyDirectRequest(request);
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
