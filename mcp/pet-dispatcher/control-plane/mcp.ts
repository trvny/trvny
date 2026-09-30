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
  executor: z.enum(["openrouter", "deepseek"]).default("openrouter").describe("Model executor: free managed router or paid DeepSeek work"),
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

const workspaceInspectInputSchema = z.object({
  target: z.string().min(1).max(128).describe("Configured repository or workspace alias"),
  path: z.string().max(1_024).default(".").describe("Workspace-relative path to inspect"),
  query: z.string().min(1).max(512).optional().describe("Optional bounded text search"),
  include: z.array(z.enum(["tree", "git"])).min(1).max(2).default(["tree", "git"]).describe("Inspection sections to include"),
  sessionId: z.string().uuid().optional().describe("Existing session to inspect, including uncommitted changes"),
  baseRef: z.string().min(1).max(256).default("main").describe("Git base ref when opening the target"),
  idempotencyKey: z.string().min(1).max(200).optional(),
  waitSeconds: z.number().int().min(0).max(45).default(20),
  debug: debugSchema,
}).strict();
const readFilesInputSchema = z.object({
  target: z.string().min(1).max(128).describe("Configured repository or workspace alias"),
  paths: z.array(z.string().min(1).max(1_024)).min(1).max(32).describe("Workspace-relative text file paths"),
  sessionId: z.string().uuid().optional().describe("Existing session to read from"),
  maxBytesPerFile: z.number().int().min(1).max(65_536).optional(),
  maxTotalBytes: z.number().int().min(1).max(81_920).optional(),
  baseRef: z.string().min(1).max(256).default("main").describe("Git base ref when opening the target"),
  idempotencyKey: z.string().min(1).max(200).optional(),
  waitSeconds: z.number().int().min(0).max(45).default(20),
  debug: debugSchema,
}).strict();
const finishSessionInputSchema = z.object({
  target: z.string().min(1).max(128).describe("Repository or workspace alias that owns the session"),
  sessionId: z.string().uuid().describe("Session to stage, commit/export when applicable, and close"),
  message: z.string().min(1).max(500).optional().describe("Optional commit message"),
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

async function runDirectTool(
  operations: ControlMcpOperations,
  input: { repo: string; baseRef: string; call: unknown },
  idempotencyKey: string | undefined,
  waitSeconds: number,
  debug: boolean,
) {
  const value = { ...input, call: remoteDirectCallSchema.parse(input.call) };
  const stableKey = idempotencyKey ? await scopedIdempotencyKey("direct", idempotencyKey, value) : undefined;
  const submitted = await operations.direct(value, stableKey);
  return asToolResult(await awaitTask(operations, submitted, waitSeconds), debug);
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
    instructions: "Use focused tools first: pet_workspace_inspect for reconnaissance, pet_read_files for bounded reads, and pet_session_finish to finalize a direct session. Use pet_delegate for multi-step reasoning or coding. Use pet_direct only when no focused facade covers the required direct operation. Call pet_meta only when target or capability discovery is actually needed.",
  });

  server.registerTool("pet_meta", {
    description: "Use this when target aliases, device freshness, capabilities, active work, or sandbox status are needed. Do not use it as a mandatory preflight for every Pet Dispatcher call.",
    outputSchema: metaOutputSchema,
    annotations: { title: "Pet Dispatcher status", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => asToolResult(await operations.meta(), true));

  server.registerTool("pet_delegate", {
    description: "Use this when the user needs multi-step reasoning, coding, debugging, or investigation on the paired machine. Do not use it for simple workspace reconnaissance or bounded file reads covered by focused tools.",
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
    description: "Use this only as the advanced compatibility fallback when no focused Pet Dispatcher tool covers the required direct operation. Write/exec calls auto-open a reusable session by default; finish it with pet_session_finish.",
    inputSchema: directInputSchema,
    outputSchema: taskOutputSchema,
    annotations: { title: "Run direct tool", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ target, tool, args, autoSession, baseRef, idempotencyKey, waitSeconds, debug }) => {
    const callArgs: Record<string, unknown> = { ...args };
    if (AUTO_SESSION_TOOLS.has(tool) && !("sessionId" in callArgs) && !("autoSession" in callArgs)) callArgs.autoSession = autoSession;
    const call = remoteDirectCallSchema.parse({ ...callArgs, tool });
    return runDirectTool(operations, { repo: target, baseRef, call }, idempotencyKey, waitSeconds, debug);
  });

  server.registerTool("pet_workspace_inspect", {
    description: "Use this when you need bounded repository or workspace reconnaissance: a compact tree, optional text search, and Git summary. Prefer it over pet_delegate for initial inspection.",
    inputSchema: workspaceInspectInputSchema,
    outputSchema: taskOutputSchema,
    annotations: { title: "Inspect workspace", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ target, path, query, include, sessionId, baseRef, idempotencyKey, waitSeconds, debug }) =>
    runDirectTool(operations, {
      repo: target, baseRef,
      call: { tool: "workspace.inspect", path, query, include, sessionId },
    }, idempotencyKey, waitSeconds, debug));

  server.registerTool("pet_read_files", {
    description: "Use this when you need the contents of one or more known text files from a configured target. Prefer it over pet_direct fs.read/fs.readMany and do not use it for broad discovery.",
    inputSchema: readFilesInputSchema,
    outputSchema: taskOutputSchema,
    annotations: { title: "Read workspace files", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ target, paths, sessionId, maxBytesPerFile, maxTotalBytes, baseRef, idempotencyKey, waitSeconds, debug }) =>
    runDirectTool(operations, {
      repo: target, baseRef,
      call: { tool: "fs.readMany", paths, sessionId, maxBytesPerFile, maxTotalBytes },
    }, idempotencyKey, waitSeconds, debug));

  server.registerTool("pet_session_finish", {
    description: "Use this when a Pet Dispatcher direct write/exec session is ready to be finalized. It stages and commits/exports changes when applicable, then closes the session. Do not use it to discard work.",
    inputSchema: finishSessionInputSchema,
    outputSchema: taskOutputSchema,
    annotations: { title: "Finish Pet session", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async ({ target, sessionId, message, idempotencyKey, waitSeconds, debug }) =>
    runDirectTool(operations, {
      repo: target, baseRef: "main",
      call: { tool: "session.finish", sessionId, message },
    }, idempotencyKey, waitSeconds, debug));

  server.registerTool("pet_task_get", {
    description: "Use this when a previously submitted Pet Dispatcher task is still pending or its bounded result is needed.",
    inputSchema: z.object({ taskId: z.string().uuid(), debug: debugSchema }).strict(),
    outputSchema: taskOutputSchema,
    annotations: { title: "Get task state", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ taskId, debug }) => asToolResult(await operations.getTask(taskId), debug));

  server.registerTool("pet_task_cancel", {
    description: "Use this when the user wants to stop a queued or running Pet Dispatcher task. Do not use it for already terminal tasks.",
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
