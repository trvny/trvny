import {
  remoteResultSchema,
  remoteTaskSchema,
  remoteTaskStateSchema,
  signEnvelope,
  verifyWorkerRequest,
  type RemoteTaskState,
} from "../src/remote-protocol.js";

interface Env {
  TASK_QUEUE: Queue;
  TASK_STATE: DurableObjectNamespace;
  CONTROL_PLANE_TOKEN?: string;
  TASK_SIGNING_SECRET?: string;
  DEVICE_ID?: string;
}

const MAX_BODY_BYTES = 128 * 1024;
const WORKER_CLOCK_SKEW_MS = 5 * 60_000;
const NONCE_HISTORY_LIMIT = 64;
const STATE_KEY = "state";
const NONCES_KEY = "worker-nonces";

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

function stateStub(env: Env, taskId: string): DurableObjectStub {
  return env.TASK_STATE.get(env.TASK_STATE.idFromName(taskId));
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
    const current = await this.state.storage.get<RemoteTaskState>(STATE_KEY);

    if (request.method === "GET" && url.pathname === "/state") {
      return current ? json(current) : json({ error: "task_not_found" }, 404);
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const body = await readBody(request);
    if (url.pathname === "/init") {
      if (current) return json(current);
      const next = remoteTaskStateSchema.parse(JSON.parse(body) as unknown);
      await this.state.storage.put(STATE_KEY, next);
      return json(next, 201);
    }
    if (!current) return json({ error: "task_not_found" }, 404);

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

async function delegate(request: Request, env: Env): Promise<Response> {
  const raw = await readBody(request);
  const task = remoteTaskSchema.parse(JSON.parse(raw) as unknown);
  const now = Date.now();
  const taskId = crypto.randomUUID();
  const envelope = {
    version: 1 as const,
    taskId,
    deviceId: deviceId(env),
    nonce: crypto.randomUUID(),
    issuedAt: now,
    expiresAt: Math.min(now + 24 * 60 * 60_000, now + (task.timeoutMinutes + 15) * 60_000),
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
  const init = await stateStub(env, taskId).fetch("https://state/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(initial),
  });
  if (!init.ok) throw new Error(`failed to initialize remote task state: HTTP ${init.status}`);
  try {
    await env.TASK_QUEUE.send(JSON.stringify(signed), { contentType: "text" });
  } catch {
    await stateStub(env, taskId).fetch("https://state/enqueue-failed", {
      method: "POST",
      body: "{}",
    });
    throw new Error("failed to enqueue remote task");
  }
  return json({ taskId, status: "queued", expiresAt: new Date(envelope.expiresAt).toISOString() }, 202);
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
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "pet-dispatcher-control" });
      }

      const workerMatch = url.pathname.match(/^\/v1\/worker\/tasks\/([0-9a-f-]{36})\/(lease|heartbeat|result)$/u);
      if (workerMatch) {
        if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
        const taskId = workerMatch[1];
        const action = workerMatch[2];
        if (!taskId || !action) return json({ error: "not_found" }, 404);
        return workerUpdate(request, env, taskId, action);
      }

      if (!controlAuthorized(request, env)) return json({ error: "unauthorized" }, 401);
      if (request.method === "GET" && url.pathname === "/v1/meta") {
        return json({ deviceId: deviceId(env), transport: "cloudflare-queues-http-pull", protocol: 1 });
      }
      if (request.method === "POST" && url.pathname === "/v1/delegate") {
        return delegate(request, env);
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
        : message.includes("JSON") || message.includes("validation") ? 400
          : 500;
      return json({ error: status === 500 ? "internal_error" : "invalid_request" }, status);
    }
  },
};

