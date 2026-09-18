import type { DurableObjectStateLike, Env } from "./types";

export type LegionWatchCondition = "offline" | "online";
export type GithubWatchCondition = "ci-failed" | "ci-green" | "merged" | "closed";

type WatchBase = {
  id: string;
  chatId: string | number;
  replyToMessageId: number;
  messageThreadId?: number;
  createdAt: string;
  lastCheckedAt?: string;
  nextCheckAt: string;
  status: "active" | "checking";
  leaseUntil?: string;
  failures: number;
};

export type LegionConditionWatch = WatchBase & {
  kind: "legion";
  condition: LegionWatchCondition;
  lastMatch: boolean;
};

export type GithubConditionWatch = WatchBase & {
  kind: "github";
  repository: string;
  number: number;
  condition: GithubWatchCondition;
  lastMatch: boolean;
};

export type FeedseekConditionWatch = WatchBase & {
  kind: "feedseek";
  query: string;
  cursorAt: string;
  seenIds: string[];
};

export type ConditionWatch =
  | LegionConditionWatch
  | GithubConditionWatch
  | FeedseekConditionWatch;

const STORE_KEY = "condition-watches";
const MAX_WATCHES = 32;
const DUE_LIMIT = 12;
const WATCH_ID_RE = /^w[0-9a-z]{1,16}$/u;
const FEEDSEEK_ID_MAX = 200;
const MAX_SEEN_IDS = 100;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function finiteDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validChatId(value: unknown): boolean {
  return (typeof value === "string" && /^-?\d+$/u.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value));
}

function validBase(item: Record<string, unknown>): boolean {
  return typeof item.id === "string" && WATCH_ID_RE.test(item.id) &&
    validChatId(item.chatId) &&
    typeof item.replyToMessageId === "number" &&
    Number.isSafeInteger(item.replyToMessageId) &&
    item.replyToMessageId > 0 &&
    (item.messageThreadId === undefined ||
      (typeof item.messageThreadId === "number" &&
        Number.isSafeInteger(item.messageThreadId) &&
        item.messageThreadId > 0)) &&
    finiteDate(item.createdAt) &&
    (item.lastCheckedAt === undefined || finiteDate(item.lastCheckedAt)) &&
    finiteDate(item.nextCheckAt) &&
    (item.status === "active" || item.status === "checking") &&
    (item.leaseUntil === undefined || finiteDate(item.leaseUntil)) &&
    typeof item.failures === "number" &&
    Number.isSafeInteger(item.failures) &&
    item.failures >= 0 &&
    item.failures <= 1000;
}

function validWatch(value: unknown): value is ConditionWatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (!validBase(item)) return false;

  if (item.kind === "legion") {
    return (item.condition === "offline" || item.condition === "online") &&
      typeof item.lastMatch === "boolean";
  }

  if (item.kind === "github") {
    return typeof item.repository === "string" &&
      /^(?:trvny|travnie)\/[A-Za-z0-9_.-]{1,100}$/u.test(item.repository) &&
      typeof item.number === "number" &&
      Number.isSafeInteger(item.number) &&
      item.number > 0 &&
      item.number <= 1_000_000 &&
      ["ci-failed", "ci-green", "merged", "closed"].includes(String(item.condition)) &&
      typeof item.lastMatch === "boolean";
  }

  if (item.kind === "feedseek") {
    return typeof item.query === "string" &&
      item.query.trim().length > 0 &&
      item.query.length <= 500 &&
      finiteDate(item.cursorAt) &&
      Array.isArray(item.seenIds) &&
      item.seenIds.length <= MAX_SEEN_IDS &&
      item.seenIds.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= FEEDSEEK_ID_MAX);
  }

  return false;
}

function validIdPayload(value: unknown): value is { id: string } {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).id === "string" &&
    WATCH_ID_RE.test((value as Record<string, string>).id),
  );
}

function leaseExpired(watch: ConditionWatch, now: number): boolean {
  return watch.status === "checking" &&
    (!watch.leaseUntil || Date.parse(watch.leaseUntil) <= now);
}

export class TelegramWatchStore {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const stored = (await this.state.storage.get<ConditionWatch[]>(STORE_KEY)) ?? [];
    const watches = stored.filter(validWatch);

    if (request.method === "GET" && url.pathname === "/list") {
      return json(watches);
    }

    if (request.method === "GET" && url.pathname === "/due") {
      const now = Date.now();
      return json(
        watches
          .filter((watch) =>
            (watch.status === "active" && Date.parse(watch.nextCheckAt) <= now) ||
            leaseExpired(watch, now)
          )
          .sort((a, b) => Date.parse(a.nextCheckAt) - Date.parse(b.nextCheckAt))
          .slice(0, DUE_LIMIT),
      );
    }

    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
    const payload = await request.json();

    if (url.pathname === "/create") {
      if (!validWatch(payload) || payload.status !== "active") {
        return json({ error: "invalid_watch" }, 400);
      }
      const existing = watches.find((watch) => watch.id === payload.id);
      if (existing) return json(existing);
      if (watches.length >= MAX_WATCHES) return json({ error: "watch_limit" }, 409);
      await this.state.storage.put(STORE_KEY, [...watches, payload]);
      return json(payload, 201);
    }

    if (url.pathname === "/update") {
      if (!validWatch(payload) || payload.status !== "active") {
        return json({ error: "invalid_watch" }, 400);
      }
      const index = watches.findIndex((watch) => watch.id === payload.id);
      if (index < 0) return json({ error: "not_found" }, 404);
      const next = watches.map((watch, watchIndex) =>
        watchIndex === index ? payload : watch
      );
      await this.state.storage.put(STORE_KEY, next);
      return json(payload);
    }

    if (!validIdPayload(payload)) return json({ error: "invalid_watch_id" }, 400);
    const index = watches.findIndex((watch) => watch.id === payload.id);

    if (url.pathname === "/claim") {
      if (index < 0) return json({ claimed: false }, 404);
      const now = Date.now();
      const current = watches[index];
      const due = current.status === "active"
        ? Date.parse(current.nextCheckAt) <= now
        : leaseExpired(current, now);
      if (!due) return json({ claimed: false }, 409);
      const claimed: ConditionWatch = {
        ...current,
        status: "checking",
        leaseUntil: new Date(now + 2 * 60_000).toISOString(),
      };
      await this.state.storage.put(
        STORE_KEY,
        watches.map((watch, watchIndex) => watchIndex === index ? claimed : watch),
      );
      return json({ claimed: true, watch: claimed });
    }

    if (url.pathname === "/release") {
      if (index >= 0) {
        const current = watches[index];
        const delayRaw = (payload as { id: string; delayMs?: unknown }).delayMs;
        const delayMs = typeof delayRaw === "number" && Number.isFinite(delayRaw)
          ? Math.max(60_000, Math.min(30 * 60_000, Math.trunc(delayRaw)))
          : 2 * 60_000;
        const released: ConditionWatch = {
          ...current,
          status: "active",
          failures: Math.min(1000, current.failures + 1),
          nextCheckAt: new Date(Date.now() + delayMs).toISOString(),
        };
        delete released.leaseUntil;
        await this.state.storage.put(
          STORE_KEY,
          watches.map((watch, watchIndex) => watchIndex === index ? released : watch),
        );
      }
      return json({ ok: true });
    }

    if (url.pathname === "/cancel") {
      const removed = index >= 0;
      if (removed) {
        await this.state.storage.put(
          STORE_KEY,
          watches.filter((watch) => watch.id !== payload.id),
        );
      }
      return json({ ok: true, removed });
    }

    return json({ error: "not_found" }, 404);
  }
}

function watchStub(env: Env) {
  return env.TELEGRAM_WATCHES.get(env.TELEGRAM_WATCHES.idFromName("owner-condition-watches"));
}

async function post(env: Env, path: string, payload: unknown): Promise<Response> {
  return watchStub(env).fetch(`https://condition-watches${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function watchIdForUpdate(updateId: number): string {
  if (!Number.isSafeInteger(updateId) || updateId < 0) {
    throw new RangeError("invalid Telegram update id");
  }
  return `w${updateId.toString(36)}`;
}

export async function createConditionWatch(env: Env, watch: ConditionWatch): Promise<ConditionWatch> {
  const response = await post(env, "/create", watch);
  if (!response.ok) throw new Error(`watch create failed: HTTP ${response.status}`);
  return response.json() as Promise<ConditionWatch>;
}

export async function listConditionWatches(env: Env): Promise<ConditionWatch[]> {
  const response = await watchStub(env).fetch("https://condition-watches/list");
  if (!response.ok) throw new Error(`watch list failed: HTTP ${response.status}`);
  return response.json() as Promise<ConditionWatch[]>;
}

export async function dueConditionWatches(env: Env): Promise<ConditionWatch[]> {
  const response = await watchStub(env).fetch("https://condition-watches/due");
  if (!response.ok) throw new Error(`watch due read failed: HTTP ${response.status}`);
  return response.json() as Promise<ConditionWatch[]>;
}

export async function claimConditionWatch(env: Env, id: string): Promise<ConditionWatch | null> {
  const response = await post(env, "/claim", { id });
  if (response.status === 404 || response.status === 409) return null;
  if (!response.ok) throw new Error(`watch claim failed: HTTP ${response.status}`);
  const result = await response.json() as { claimed?: boolean; watch?: ConditionWatch };
  return result.claimed && result.watch ? result.watch : null;
}

export async function updateConditionWatch(env: Env, watch: ConditionWatch): Promise<void> {
  const response = await post(env, "/update", watch);
  if (!response.ok) throw new Error(`watch update failed: HTTP ${response.status}`);
}

export async function releaseConditionWatch(env: Env, id: string, delayMs?: number): Promise<void> {
  const response = await post(env, "/release", { id, ...(delayMs ? { delayMs } : {}) });
  if (!response.ok) throw new Error(`watch release failed: HTTP ${response.status}`);
}

export async function cancelConditionWatch(env: Env, id: string): Promise<boolean> {
  const response = await post(env, "/cancel", { id });
  if (!response.ok) throw new Error(`watch cancel failed: HTTP ${response.status}`);
  const result = await response.json() as { removed?: boolean };
  return result.removed === true;
}
