import { WorkerEntrypoint } from "cloudflare:workers";
import { z, ZodError } from "zod";
import { FREE_ROUTER_WORKER_PATH, proxyKanarekFreeRouter, type FreeRouterEnv } from "./free-router.js";
import { ICON_BYTES } from "./icon.js";
import { isMcpPath, mcpAuthorized } from "./mcp-auth.js";
import { handleControlMcp, type ControlMcpOperations } from "./mcp.js";
import {
  RECENT_TASK_LIMIT,
  compactRecentTask,
  type RecentTaskRef,
  type RecentTaskSnapshot,
  upsertRecentTaskRef,
} from "./recent-task-index.js";
import { deviceMetaSchema } from "../src/device-meta.js";
import {
  REMOTE_DIRECT_TOOLS,
  assertAssistantTaskAllowed,
  buildRemoteDirectTask,
  remoteDirectCallSchema,
  remoteResultSchema,
  remoteTaskSchema,
  remoteTaskStateSchema,
  signedTaskEnvelopeSchema,
  signEnvelope,
  type SignedTaskEnvelope,
  verifyWorkerRequest,
  type RemoteTask,
  type RemoteTaskState,
} from "../src/remote-protocol.js";

interface Env extends FreeRouterEnv {
  TASK_QUEUE: Queue;
  TASK_STATE: DurableObjectNamespace;
  CF_VERSION_METADATA: WorkerVersionMetadata;
  CONTROL_PLANE_TOKEN?: string;
  MCP_CONNECTOR_TOKEN?: string;
  TASK_SIGNING_SECRET?: string;
  DEVICE_ID?: string;
}

const MAX_BODY_BYTES = 128 * 1024;
const WORKER_CLOCK_SKEW_MS = 5 * 60_000;
const NONCE_HISTORY_LIMIT = 64;
const DEVICE_NONCE_HISTORY_LIMIT = 512;
const STATE_KEY = "state";
const OUTBOX_KEY = "enqueue-outbox";
const NONCES_KEY = "worker-nonces";
const DEVICE_META_KEY = "device-meta";
const RECENT_TASKS_KEY = "recent-tasks";
const QUOTA_KEY = "daily-delegation-quota";
const DAILY_DELEGATION_LIMIT = 500;
const enqueueOutboxSchema = z.object({
  envelope: signedTaskEnvelopeSchema,
  sent: z.boolean(),
}).strict();
type EnqueueOutbox = z.infer<typeof enqueueOutboxSchema>;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function requiredSecret(env: Env, key: "CONTROL_PLANE_TOKEN" | "TASK_SIGNING_SECRET"): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

function deviceId(env: Env): string {
  if (!env.DEVICE_ID) throw new Error("DEVICE_ID is not configured");
  return env.DEVICE_ID;
}

async function idempotentTaskId(key: string): Promise<string> {
  const normalized = z.string().min(1).max(200).parse(key);
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes.slice(0, 16)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function readBody(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new Error("request body is too large");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) throw new Error("request body is too large");
  return body;
}

function controlAuthorized(request: Request, env: Env): boolean {
  const token = env.CONTROL_PLANE_TOKEN;
  if (!token) return false;
  return request.headers.get("authorization") === `Bearer ${token}`;
}

function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, {
    status: 401,
    headers: { "cache-control": "no-store", "www-authenticate": 'Bearer realm="pet-dispatcher-control"' },
  });
}


function stateStub(env: Env, taskId: string): DurableObjectStub {
  return env.TASK_STATE.get(env.TASK_STATE.idFromName(taskId));
}

function quotaStub(env: Env): DurableObjectStub {
  return env.TASK_STATE.get(env.TASK_STATE.idFromName("__pet-free-tier-budget__"));
}

function deviceMetaStub(env: Env): DurableObjectStub {
  return env.TASK_STATE.get(env.TASK_STATE.idFromName("__pet-device-meta__"));
}

function recentTasksStub(env: Env): DurableObjectStub {
  return env.TASK_STATE.get(env.TASK_STATE.idFromName("__pet-recent-tasks__"));
}

async function indexRecentTask(env: Env, state: RemoteTaskState): Promise<void> {
  try {
    const response = await recentTasksStub(env).fetch("https://state/recent-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    if (!response.ok) console.warn(`Recent task index update failed: HTTP ${response.status}`);
  } catch (error) {
    console.warn("Recent task index update failed", error);
  }
}

async function readState(env: Env, taskId: string): Promise<Response> {
  return stateStub(env, taskId).fetch("https://state/state");
}

function terminal(status: RemoteTaskState["status"]): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "recovery_required";
}

export class TaskStateStore {
  constructor(readonly state: DurableObjectState, readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/recent-tasks") {
      if (request.method === "GET") {
        const stored = (await this.state.storage.get<RecentTaskRef[]>(RECENT_TASKS_KEY)) ?? [];
        return json(stored.slice(0, RECENT_TASK_LIMIT));
      }
      if (request.method === "POST") {
        const body = await readBody(request);
        const task = remoteTaskStateSchema.parse(JSON.parse(body) as unknown);
        const stored = (await this.state.storage.get<RecentTaskRef[]>(RECENT_TASKS_KEY)) ?? [];
        const next = upsertRecentTaskRef(stored, task);
        await this.state.storage.put(RECENT_TASKS_KEY, next);
        return json(next);
      }
      return json({ error: "method_not_allowed" }, 405);
    }
    if (url.pathname === "/device-meta") {
      if (request.method === "GET") {
        const stored = await this.state.storage.get(DEVICE_META_KEY);
        return stored ? json(deviceMetaSchema.parse(stored)) : json({ error: "device_meta_not_found" }, 404);
      }
      if (request.method === "POST") {
        const body = await readBody(request);
        const meta = deviceMetaSchema.parse(JSON.parse(body) as unknown);
        await this.state.storage.put(DEVICE_META_KEY, meta);
        return json(meta);
      }
      return json({ error: "method_not_allowed" }, 405);
    }
    if (url.pathname === "/worker-nonce") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
      const body = await readBody(request);
      const { nonce } = z.object({ nonce: z.string().uuid() }).strict().parse(JSON.parse(body) as unknown);
      const nonces = (await this.state.storage.get<string[]>(NONCES_KEY)) ?? [];
      if (nonces.includes(nonce)) return json({ error: "replayed_worker_request" }, 409);
      await this.state.storage.put(NONCES_KEY, [nonce, ...nonces].slice(0, DEVICE_NONCE_HISTORY_LIMIT));
      return json({ ok: true }, 201);
    }
    const current = await this.state.storage.get<RemoteTaskState>(STATE_KEY);

    if (request.method === "GET" && url.pathname === "/state") {
      return current ? json(current) : json({ error: "task_not_found" }, 404);
    }
    if (request.method === "GET" && url.pathname === "/outbox") {
      const outbox = await this.state.storage.get<EnqueueOutbox>(OUTBOX_KEY);
      return outbox ? json(enqueueOutboxSchema.parse(outbox)) : json({ error: "outbox_not_found" }, 404);
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const body = await readBody(request);
    if (url.pathname.startsWith("/quota/")) {
      const { taskId } = z.object({ taskId: z.string().uuid() }).strict().parse(JSON.parse(body) as unknown);
      const day = new Date().toISOString().slice(0, 10);
      const stored = await this.state.storage.get<{ day: string; count: number; pending: string[] }>(QUOTA_KEY);
      const quota = stored?.day === day ? stored : { day, count: 0, pending: [] };
      const pending = new Set(quota.pending);
      if (url.pathname === "/quota/reserve") {
        if (pending.has(taskId)) return json({ ...quota, limit: DAILY_DELEGATION_LIMIT });
        if (quota.count >= DAILY_DELEGATION_LIMIT) {
          return json({ error: "free_tier_task_budget_exhausted", limit: DAILY_DELEGATION_LIMIT }, 429);
        }
        pending.add(taskId);
        const next = { day, count: quota.count + 1, pending: [...pending] };
        await this.state.storage.put(QUOTA_KEY, next);
        return json({ ...next, limit: DAILY_DELEGATION_LIMIT }, 201);
      }
      if (url.pathname === "/quota/release") {
        if (pending.delete(taskId)) quota.count = Math.max(0, quota.count - 1);
        const next = { day, count: quota.count, pending: [...pending] };
        await this.state.storage.put(QUOTA_KEY, next);
        return json({ ...next, limit: DAILY_DELEGATION_LIMIT });
      }
      if (url.pathname === "/quota/commit") {
        pending.delete(taskId);
        const next = { day, count: quota.count, pending: [...pending] };
        await this.state.storage.put(QUOTA_KEY, next);
        return json({ ...next, limit: DAILY_DELEGATION_LIMIT });
      }
      return json({ error: "not_found" }, 404);
    }
    if (url.pathname === "/init") {
      if (current) return json(current);
      const parsed = z.object({
        state: remoteTaskStateSchema,
        envelope: signedTaskEnvelopeSchema,
      }).strict().parse(JSON.parse(body) as unknown);
      await this.state.storage.transaction(async (txn) => {
        await txn.put(STATE_KEY, parsed.state);
        await txn.put(OUTBOX_KEY, { envelope: parsed.envelope, sent: false } satisfies EnqueueOutbox);
      });
      await indexRecentTask(this.env, parsed.state);
      return json(parsed.state, 201);
    }
    if (!current) return json({ error: "task_not_found" }, 404);

    if (url.pathname === "/outbox/sent") {
      const outbox = await this.state.storage.get<EnqueueOutbox>(OUTBOX_KEY);
      if (!outbox) return json({ error: "outbox_not_found" }, 404);
      const next = enqueueOutboxSchema.parse({ ...outbox, sent: true });
      await this.state.storage.put(OUTBOX_KEY, next);
      return json(next);
    }

    if (url.pathname === "/enqueue-failed") {
      if (terminal(current.status)) return json(current);
      const result = {
        status: "failed" as const,
        summary: "The control plane could not enqueue this task.",
        error: "Cloudflare Queue enqueue failed before worker delivery",
      };
      const next: RemoteTaskState = {
        ...current,
        status: "failed",
        result,
        updatedAt: new Date().toISOString(),
      };
      await this.state.storage.put(STATE_KEY, next);
      return json(next);
    }

    if (url.pathname === "/cancel") {
      if (terminal(current.status)) return json(current);
      const next = {
        ...current,
        status: "cancel_requested" as const,
        cancelRequested: true,
        updatedAt: new Date().toISOString(),
      };
      await this.state.storage.put(STATE_KEY, next);
      return json(next);
    }
    if (!url.pathname.startsWith("/worker/")) return json({ error: "not_found" }, 404);
    const nonce = request.headers.get("x-pet-nonce");
    if (!nonce) return json({ error: "missing_worker_nonce" }, 400);
    const nonces = (await this.state.storage.get<string[]>(NONCES_KEY)) ?? [];
    if (nonces.includes(nonce)) return json({ error: "replayed_worker_request" }, 409);
    await this.state.storage.put(NONCES_KEY, [nonce, ...nonces].slice(0, NONCE_HISTORY_LIMIT));

    const now = new Date().toISOString();
    if (url.pathname === "/worker/lease" || url.pathname === "/worker/heartbeat") {
      if (terminal(current.status)) return json(current);
      const next: RemoteTaskState = {
        ...current,
        status: current.cancelRequested ? "cancel_requested" : "running",
        updatedAt: now,
        heartbeatAt: now,
      };
      await this.state.storage.put(STATE_KEY, next);
      return json(next);
    }

    if (url.pathname === "/worker/result") {
      if (terminal(current.status)) return json(current);
      const result = remoteResultSchema.parse(JSON.parse(body) as unknown);
      const next: RemoteTaskState = {
        ...current,
        status: result.status,
        result,
        updatedAt: now,
        heartbeatAt: now,
      };
      await this.state.storage.put(STATE_KEY, next);
      return json(next);
    }
    return json({ error: "not_found" }, 404);
  }
}

async function workerAuthorized(request: Request, env: Env, body: string): Promise<boolean> {
  const expectedDevice = deviceId(env);
  const presentedDevice = request.headers.get("x-pet-device") ?? "";
  const timestamp = request.headers.get("x-pet-timestamp") ?? "";
  const nonce = request.headers.get("x-pet-nonce") ?? "";
  const signature = request.headers.get("x-pet-signature") ?? "";
  if (presentedDevice !== expectedDevice || !timestamp || !nonce || !signature) return false;
  const parsedTime = Number(timestamp);
  if (!Number.isFinite(parsedTime) || Math.abs(Date.now() - parsedTime) > WORKER_CLOCK_SKEW_MS) return false;
  return verifyWorkerRequest(
    requiredSecret(env, "TASK_SIGNING_SECRET"),
    signature,
    request.method,
    new URL(request.url).pathname,
    timestamp,
    nonce,
    body,
  );
}

async function deliverOutbox(env: Env, taskId: string, envelope: SignedTaskEnvelope, quotaBody: string): Promise<void> {
  try {
    await env.TASK_QUEUE.send(JSON.stringify(envelope), { contentType: "text" });
  } catch (error) {
    await stateStub(env, taskId).fetch("https://state/enqueue-failed", {
      method: "POST",
      body: "{}",
    }).catch(() => undefined);
    await quotaStub(env).fetch("https://state/quota/release", { method: "POST", body: quotaBody }).catch(() => undefined);
    throw error;
  }
  const marked = await stateStub(env, taskId).fetch("https://state/outbox/sent", { method: "POST", body: "{}" });
  if (!marked.ok) throw new Error(`failed to persist queue delivery receipt: HTTP ${marked.status}`);
  await quotaStub(env).fetch("https://state/quota/commit", { method: "POST", body: quotaBody }).catch(() => undefined);
}

async function enqueueTask(task: RemoteTask, env: Env, stableTaskId?: string): Promise<Response> {
  const now = Date.now();
  const taskId = stableTaskId ?? crypto.randomUUID();
  const quotaBody = JSON.stringify({ taskId });
  if (stableTaskId) {
    const existingResponse = await readState(env, taskId);
    if (existingResponse.ok) {
      const existing = remoteTaskStateSchema.parse(await existingResponse.json());
      if (!terminal(existing.status)) {
        const outboxResponse = await stateStub(env, taskId).fetch("https://state/outbox");
        if (!outboxResponse.ok) throw new Error(`failed to read queue outbox: HTTP ${outboxResponse.status}`);
        const outbox = enqueueOutboxSchema.parse(await outboxResponse.json());
        if (!outbox.sent) await deliverOutbox(env, taskId, outbox.envelope, quotaBody);
        else await quotaStub(env).fetch("https://state/quota/commit", { method: "POST", body: quotaBody }).catch(() => undefined);
      }
      return json({ taskId, status: existing.status }, 202);
    }
    if (existingResponse.status !== 404) {
      throw new Error(`failed to check idempotent task state: HTTP ${existingResponse.status}`);
    }
  }
  const quota = await quotaStub(env).fetch("https://state/quota/reserve", { method: "POST", body: quotaBody });
  if (!quota.ok) {
    if (quota.status === 429) return json({ error: "free_tier_task_budget_exhausted" }, 429);
    throw new Error(`failed to reserve free-tier task budget: HTTP ${quota.status}`);
  }
  const envelope = {
    version: 1 as const,
    taskId,
    deviceId: deviceId(env),
    nonce: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: now + 24 * 60 * 60_000,
    task,
  };
  const signed = await signEnvelope(envelope, requiredSecret(env, "TASK_SIGNING_SECRET"));
  const createdAt = new Date(now).toISOString();
  const initial: RemoteTaskState = {
    taskId,
    deviceId: envelope.deviceId,
    status: "queued",
    createdAt,
    updatedAt: createdAt,
    cancelRequested: false,
  };
  try {
    const init = await stateStub(env, taskId).fetch("https://state/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: initial, envelope: signed }),
    });
    if (!init.ok) throw new Error(`failed to initialize remote task state: HTTP ${init.status}`);
  } catch (error) {
    await quotaStub(env).fetch("https://state/quota/release", { method: "POST", body: quotaBody }).catch(() => undefined);
    throw error;
  }
  await deliverOutbox(env, taskId, signed, quotaBody);
  return json({ taskId, status: "queued", expiresAt: new Date(envelope.expiresAt).toISOString() }, 202);
}

async function delegate(request: Request, env: Env): Promise<Response> {
  const raw = await readBody(request);
  return enqueueTask(remoteTaskSchema.parse(JSON.parse(raw) as unknown), env);
}

function assistantTask(value: unknown): RemoteTask {
  const task = remoteTaskSchema.parse(value);
  assertAssistantTaskAllowed(task);
  return task;
}

type RpcResult = { status: number; body: unknown };

async function rpcResult(response: Response): Promise<RpcResult> {
  return { status: response.status, body: await response.json() };
}

async function controlMeta(env: Env) {
  const response = await deviceMetaStub(env).fetch("https://state/device-meta");
  if (response.ok) {
    const meta = deviceMetaSchema.parse(await response.json());
    return { ...meta, stale: Date.now() - Date.parse(meta.updatedAt) > 60_000 };
  }
  return {
    deviceId: deviceId(env), transport: "cloudflare-queues-http-pull" as const, protocol: 1 as const,
    updatedAt: null, repositories: [], workspaces: [], directTools: [...REMOTE_DIRECT_TOOLS], localTools: [],
    activeSessions: 0, activeProcesses: 0, stale: true,
    sandbox: { supported: false, processGuard: "unknown", networkDefault: "deny", isolationTier: null },
  };
}

async function delegateAssistant(value: unknown, env: Env, idempotencyKey?: string): Promise<RpcResult> {
  const taskId = idempotencyKey ? await idempotentTaskId(idempotencyKey) : undefined;
  return rpcResult(await enqueueTask(assistantTask(value), env, taskId));
}

async function getTaskResult(taskId: string, env: Env): Promise<RpcResult> {
  const id = z.string().uuid().parse(taskId);
  return rpcResult(await readState(env, id));
}

async function cancelTaskResult(taskId: string, env: Env): Promise<RpcResult> {
  const id = z.string().uuid().parse(taskId);
  return rpcResult(await stateStub(env, id).fetch("https://state/cancel", { method: "POST", body: "{}" }));
}

async function recentTaskSnapshots(env: Env, limit = 10): Promise<RecentTaskSnapshot[]> {
  const bounded = Math.max(1, Math.min(z.number().int().parse(limit), RECENT_TASK_LIMIT));
  const response = await recentTasksStub(env).fetch("https://state/recent-tasks");
  if (!response.ok) throw new Error(`failed to read recent task index: HTTP ${response.status}`);
  const refs = (await response.json() as RecentTaskRef[]).slice(0, bounded);
  const states = await Promise.all(refs.map(async ({ taskId }) => {
    const state = await readState(env, taskId);
    if (!state.ok) return null;
    return remoteTaskStateSchema.parse(await state.json());
  }));
  return states.filter((state): state is RemoteTaskState => state !== null).map(compactRecentTask);
}

function mcpOperations(env: Env): ControlMcpOperations {
  return {
    meta: async () => ({ status: 200, body: await controlMeta(env) }),
    delegate: (value, key) => delegateAssistant(value, env, key),
    direct: async (value, key) => {
      const taskId = key ? await idempotentTaskId(key) : undefined;
      return rpcResult(await enqueueDirectTool(value, env, taskId));
    },
    getTask: (taskId) => getTaskResult(taskId, env),
    cancelTask: (taskId) => cancelTaskResult(taskId, env),
  };
}

async function boundedMcpRequest(request: Request): Promise<Request> {
  if (request.method !== "POST") return request;
  const body = await readBody(request);
  return new Request(request.url, { method: request.method, headers: request.headers, body });
}

export class TelegramAssistantEntrypoint extends WorkerEntrypoint<Env> {
  async meta() {
    return controlMeta(this.env);
  }

  async delegate(value: unknown, idempotencyKey?: string): Promise<RpcResult> {
    return delegateAssistant(value, this.env, idempotencyKey);
  }

  async getTask(taskId: string): Promise<RpcResult> {
    return getTaskResult(taskId, this.env);
  }

  async recentTasks(limit = 10): Promise<RecentTaskSnapshot[]> {
    return recentTaskSnapshots(this.env, limit);
  }

  async cancelTask(taskId: string): Promise<RpcResult> {
    return cancelTaskResult(taskId, this.env);
  }
}

const directToolInputSchema = z.object({
  repo: z.string().min(1).max(128),
  baseRef: z.string().min(1).max(256).default("main"),
  call: remoteDirectCallSchema,
}).strict();

async function enqueueDirectTool(value: unknown, env: Env, stableTaskId?: string): Promise<Response> {
  const input = directToolInputSchema.parse(value);
  const task = buildRemoteDirectTask(input);
  return enqueueTask(task, env, stableTaskId);
}

async function directTool(request: Request, env: Env): Promise<Response> {
  const raw = await readBody(request);
  return enqueueDirectTool(JSON.parse(raw) as unknown, env);
}

async function workerFreeRouter(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  if (!await workerAuthorized(request, env, body)) return json({ error: "unauthorized" }, 401);
  const nonce = request.headers.get("x-pet-nonce");
  if (!nonce) return json({ error: "missing_worker_nonce" }, 400);
  const claimed = await deviceMetaStub(env).fetch("https://state/worker-nonce", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce }),
  });
  if (!claimed.ok) {
    if (claimed.status === 409) return json({ error: "replayed_worker_request" }, 409);
    return json({ error: "worker_nonce_store_failed" }, 503);
  }
  return proxyKanarekFreeRouter(body, env, request.signal);
}

async function workerMetaUpdate(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  if (!await workerAuthorized(request, env, body)) return json({ error: "unauthorized" }, 401);
  const meta = deviceMetaSchema.parse(JSON.parse(body) as unknown);
  if (meta.deviceId !== deviceId(env)) return json({ error: "device_mismatch" }, 400);
  return deviceMetaStub(env).fetch("https://state/device-meta", {
    method: "POST", headers: { "content-type": "application/json" }, body,
  });
}

async function workerUpdate(request: Request, env: Env, taskId: string, action: string): Promise<Response> {
  const body = await readBody(request);
  if (!await workerAuthorized(request, env, body)) return json({ error: "unauthorized" }, 401);
  if (!/^(?:lease|heartbeat|result)$/u.test(action)) return json({ error: "not_found" }, 404);
  return stateStub(env, taskId).fetch(`https://state/worker/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pet-nonce": request.headers.get("x-pet-nonce") ?? "",
    },
    body,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/icon.png") {
        return new Response(request.method === "HEAD" ? null : ICON_BYTES, {
          headers: {
            "content-type": "image/png",
            "cache-control": "public, max-age=86400",
            "access-control-allow-origin": "*",
          },
        });
      }
      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          service: "pet-dispatcher-control",
          versionId: env.CF_VERSION_METADATA.id,
        });
      }

      if (isMcpPath(url.pathname)) {
        if (!mcpAuthorized(request, env)) return unauthorized();
        return handleControlMcp(await boundedMcpRequest(request), mcpOperations(env));
      }

      if (url.pathname === FREE_ROUTER_WORKER_PATH) {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        return workerFreeRouter(request, env);
      }

      if (url.pathname === "/v1/worker/meta") {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        return workerMetaUpdate(request, env);
      }

      const workerMatch = url.pathname.match(/^\/v1\/worker\/tasks\/([0-9a-f-]{36})\/(lease|heartbeat|result)$/u);
      if (workerMatch) {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        const taskId = workerMatch[1];
        const action = workerMatch[2];
        if (!taskId || !action) return json({ error: "not_found" }, 404);
        return workerUpdate(request, env, taskId, action);
      }

      if (!controlAuthorized(request, env)) return unauthorized();
      if (request.method === "GET" && url.pathname === "/v1/meta") {
        return json(await controlMeta(env));
      }
      if (request.method === "POST" && url.pathname === "/v1/delegate") {
        return delegate(request, env);
      }
      if (request.method === "POST" && url.pathname === "/v1/tool") {
        return directTool(request, env);
      }

      const taskMatch = url.pathname.match(/^\/v1\/tasks\/([0-9a-f-]{36})(\/cancel)?$/u);
      if (!taskMatch) return json({ error: "not_found" }, 404);
      const taskId = taskMatch[1];
      if (!taskId) return json({ error: "not_found" }, 404);
      if (request.method === "GET" && !taskMatch[2]) return readState(env, taskId);
      if (request.method === "POST" && taskMatch[2] === "/cancel") {
        return stateStub(env, taskId).fetch("https://state/cancel", { method: "POST", body: "{}" });
      }
      return json({ error: "method_not_allowed" }, 405);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("request body is too large") ? 413
        : error instanceof SyntaxError || error instanceof ZodError ? 400
          : 500;
      return json({ error: status === 500 ? "internal_error" : "invalid_request" }, status);
    }
  },
};
