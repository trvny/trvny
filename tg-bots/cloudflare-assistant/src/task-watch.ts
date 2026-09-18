import type { DurableObjectStateLike, Env } from "./types";

export type TaskWatch = {
  taskId: string;
  chatId: string | number;
  replyToMessageId: number;
  messageThreadId?: number;
  repo: string;
  goal: string;
  createdAt: string;
  state: "pending" | "notifying";
};

const WATCHES_KEY = "task-watches";
const MAX_WATCHES = 32;
const PENDING_LIMIT = 12;
const WATCH_TTL_MS = 24 * 60 * 60 * 1_000;
const TASK_ID_RE = /^[0-9a-f-]{36}$/iu;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function validWatch(value: unknown): value is TaskWatch {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.taskId === "string" && TASK_ID_RE.test(item.taskId) &&
    (
      (typeof item.chatId === "string" && /^-?\d+$/u.test(item.chatId)) ||
      (typeof item.chatId === "number" && Number.isSafeInteger(item.chatId))
    ) &&
    typeof item.replyToMessageId === "number" && Number.isSafeInteger(item.replyToMessageId) &&
    item.replyToMessageId > 0 &&
    (item.messageThreadId === undefined ||
      (typeof item.messageThreadId === "number" && Number.isSafeInteger(item.messageThreadId) && item.messageThreadId > 0)) &&
    typeof item.repo === "string" && item.repo.length > 0 && item.repo.length <= 128 &&
    typeof item.goal === "string" && item.goal.length > 0 && item.goal.length <= 2_000 &&
    typeof item.createdAt === "string" && Number.isFinite(Date.parse(item.createdAt)) &&
    (item.state === "pending" || item.state === "notifying");
}

function validTaskId(value: unknown): value is { taskId: string } {
  return Boolean(
    value && typeof value === "object" &&
    typeof (value as Record<string, unknown>).taskId === "string" &&
    TASK_ID_RE.test((value as Record<string, string>).taskId),
  );
}

export class TelegramTaskWatch {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const stored = (await this.state.storage.get<TaskWatch[]>(WATCHES_KEY)) ?? [];
    const fresh = stored.filter((watch) =>
      Date.now() - Date.parse(watch.createdAt) <= WATCH_TTL_MS
    );

    if (request.method === "GET" && url.pathname === "/pending") {
      if (fresh.length !== stored.length) await this.state.storage.put(WATCHES_KEY, fresh);
      return json(fresh.filter((watch) => watch.state === "pending").slice(0, PENDING_LIMIT));
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const payload = await request.json();
    if (url.pathname === "/watch") {
      if (!validWatch(payload)) return json({ error: "invalid_watch" }, 400);
      const next = [
        ...fresh.filter((watch) => watch.taskId !== payload.taskId),
        payload,
      ].slice(-MAX_WATCHES);
      await this.state.storage.put(WATCHES_KEY, next);
      return json(payload, 201);
    }

    if (!validTaskId(payload)) return json({ error: "invalid_task_id" }, 400);
    const index = fresh.findIndex((watch) => watch.taskId === payload.taskId);
    if (url.pathname === "/reserve") {
      if (index < 0 || fresh[index].state !== "pending") return json({ reserved: false }, 409);
      const reserved = { ...fresh[index], state: "notifying" as const };
      const next = fresh.map((watch, watchIndex) => watchIndex === index ? reserved : watch);
      await this.state.storage.put(WATCHES_KEY, next);
      return json({ reserved: true, watch: reserved });
    }

    if (url.pathname === "/release") {
      if (index >= 0) {
        const next = fresh.map((watch, watchIndex) =>
          watchIndex === index ? { ...watch, state: "pending" as const } : watch
        );
        await this.state.storage.put(WATCHES_KEY, next);
      }
      return json({ ok: true });
    }

    if (url.pathname === "/finish") {
      if (index >= 0) {
        await this.state.storage.put(WATCHES_KEY, fresh.filter((watch) => watch.taskId !== payload.taskId));
      }
      return json({ ok: true });
    }
    return json({ error: "not_found" }, 404);
  }
}

function watchStub(env: Env) {
  const id = env.TELEGRAM_TASK_WATCH.idFromName("owner-task-watch");
  return env.TELEGRAM_TASK_WATCH.get(id);
}

async function post(env: Env, path: string, payload: unknown): Promise<Response> {
  return watchStub(env).fetch(`https://task-watch${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function watchTask(
  env: Env,
  watch: Omit<TaskWatch, "createdAt" | "state">,
): Promise<void> {
  const payload: TaskWatch = {
    ...watch,
    goal: watch.goal.slice(0, 2_000),
    createdAt: new Date().toISOString(),
    state: "pending",
  };
  const response = await post(env, "/watch", payload);
  if (!response.ok) throw new Error(`task watch registration failed: HTTP ${response.status}`);
}

export async function pendingTaskWatches(env: Env): Promise<TaskWatch[]> {
  const response = await watchStub(env).fetch("https://task-watch/pending");
  if (!response.ok) throw new Error(`task watch read failed: HTTP ${response.status}`);
  return response.json() as Promise<TaskWatch[]>;
}

export async function reserveTaskWatch(env: Env, taskId: string): Promise<TaskWatch | null> {
  const response = await post(env, "/reserve", { taskId });
  if (response.status === 409) return null;
  if (!response.ok) throw new Error(`task watch reserve failed: HTTP ${response.status}`);
  const body = await response.json() as { reserved?: boolean; watch?: TaskWatch };
  return body.reserved && body.watch ? body.watch : null;
}

export async function releaseTaskWatch(env: Env, taskId: string): Promise<void> {
  const response = await post(env, "/release", { taskId });
  if (!response.ok) throw new Error(`task watch release failed: HTTP ${response.status}`);
}

export async function finishTaskWatch(env: Env, taskId: string): Promise<void> {
  const response = await post(env, "/finish", { taskId });
  if (!response.ok) throw new Error(`task watch finish failed: HTTP ${response.status}`);
}
