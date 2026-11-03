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
  status: "active" | "checking" | "sending";
  leaseUntil?: string;
  claimToken?: string;
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

export type SecretaryIdleWatch = WatchBase & {
  kind: "secretary";
  connectionId: string;
  sender: string;
  contextBlock: string;
};

export type ConditionWatch =
  | LegionConditionWatch
  | GithubConditionWatch
  | FeedseekConditionWatch
  | SecretaryIdleWatch;

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
    (item.status === "active" || item.status === "checking" || item.status === "sending") &&
    (item.leaseUntil === undefined || finiteDate(item.leaseUntil)) &&
    (item.claimToken === undefined || (typeof item.claimToken === "string" && /^[0-9a-f-]{36}$/u.test(item.claimToken))) &&
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

  if (item.kind === "secretary") {
    return typeof item.connectionId === "string" &&
      item.connectionId.length > 0 && item.connectionId.length <= 256 &&
      typeof item.sender === "string" && item.sender.length > 0 && item.sender.length <= 180 &&
      typeof item.contextBlock === "string" && item.contextBlock.length > 0 && item.contextBlock.length <= 3_500;
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
    // Parse request bodies before reading state. No non-storage await between read and write.
    const payload = request.method === "POST" ? await request.json() : null;
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
      const previous = watches[index];
      if (previous.status === "active"
        ? payload.claimToken !== undefined
        : !previous.claimToken || previous.claimToken !== payload.claimToken) {
        return json({ error: "stale_claim" }, 409);
      }
      const updated = { ...payload };
      delete updated.claimToken;
      delete updated.leaseUntil;
      const next = watches.map((watch, watchIndex) =>
        watchIndex === index ? updated : watch
      );
      await this.state.storage.put(STORE_KEY, next);
      return json(updated);
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
        claimToken: crypto.randomUUID(),
      };
      await this.state.storage.put(
        STORE_KEY,
        watches.map((watch, watchIndex) => watchIndex === index ? claimed : watch),
      );
      return json({ claimed: true, watch: claimed });
    }

    if (url.pathname === "/begin-send") {
      const token = (payload as { claimToken?: unknown }).claimToken;
      if (index < 0 || watches[index].status !== "checking" ||
          typeof token !== "string" || watches[index].claimToken !== token) {
        return json({ started: false }, 409);
      }
      const sending: ConditionWatch = { ...watches[index], status: "sending" };
      await this.state.storage.put(
        STORE_KEY,
        watches.map((watch, watchIndex) => watchIndex === index ? sending : watch),
      );
      return json({ started: true });
    }

    if (url.pathname === "/release") {
      if (index >= 0) {
        const current = watches[index];
        const token = (payload as { claimToken?: unknown }).claimToken;
        if ((current.status !== "checking" && current.status !== "sending") ||
            !current.claimToken || current.claimToken !== token) {
          return json({ ok: true, released: false });
        }
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
        delete released.claimToken;
        await this.state.storage.put(
          STORE_KEY,
          watches.map((watch, watchIndex) => watchIndex === index ? released : watch),
        );
      }
      return json({ ok: true });
    }

    if (url.pathname === "/cancel") {
      const removed = index >= 0;
      const deliveryStarted = removed && watches[index].status === "sending";
      if (removed) {
        await this.state.storage.put(
          STORE_KEY,
          watches.filter((watch) => watch.id !== payload.id),
        );
      }
      return json({ ok: true, removed, deliveryStarted });
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

export async function updateConditionWatch(env: Env, watch: ConditionWatch): Promise<boolean> {
  const response = await post(env, "/update", watch);
  if (response.status === 404 || response.status === 409) return false;
  if (!response.ok) throw new Error(`watch update failed: HTTP ${response.status}`);
  return true;
}

export async function releaseConditionWatch(
  env: Env, id: string, delayMs?: number, claimToken?: string,
): Promise<void> {
  const response = await post(env, "/release", { id, ...(delayMs ? { delayMs } : {}), claimToken });
  if (!response.ok) throw new Error(`watch release failed: HTTP ${response.status}`);
}

export async function beginConditionWatchSend(env: Env, id: string, claimToken?: string): Promise<boolean> {
  const response = await post(env, "/begin-send", { id, claimToken });
  if (response.status === 409) return false;
  if (!response.ok) throw new Error(`watch begin-send failed: HTTP ${response.status}`);
  const result = await response.json() as { started?: boolean };
  return result.started === true;
}

export type WatchCancellation = { removed: boolean; deliveryStarted: boolean };

export async function cancelConditionWatchWithStatus(env: Env, id: string): Promise<WatchCancellation> {
  const response = await post(env, "/cancel", { id });
  if (!response.ok) throw new Error(`watch cancel failed: HTTP ${response.status}`);
  const result = await response.json() as Partial<WatchCancellation>;
  return { removed: result.removed === true, deliveryStarted: result.deliveryStarted === true };
}

export async function cancelConditionWatch(env: Env, id: string): Promise<boolean> {
  return (await cancelConditionWatchWithStatus(env, id)).removed;
}
