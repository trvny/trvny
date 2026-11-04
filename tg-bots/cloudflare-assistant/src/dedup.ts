import type {
  DurableObjectStateLike,
  TelegramReply,
  TelegramUpdateRecord,
} from "./types";

const RECORD_KEY = "record";
const STOP_REQUESTED_KEY = "stop-requested";
const RETENTION_MS = 7 * 24 * 60 * 60_000;
const CLAIM_LEASE_MS = 3 * 60_000;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function terminal(status: TelegramUpdateRecord["status"]): boolean {
  return status === "sent" || status === "failed" || status === "ambiguous";
}

export class TelegramUpdateDedup {
  private serial: Promise<void> = Promise.resolve();

  constructor(private readonly state: DurableObjectStateLike) {}

  // Serialize read-modify-write sequences, including under concurrent Queue deliveries.
  fetch(request: Request): Promise<Response> {
    const work = this.serial.then(() => this.handle(request));
    this.serial = work.then(() => undefined, () => undefined);
    return work;
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const current = await this.state.storage.get<TelegramUpdateRecord>(RECORD_KEY);

    if (request.method === "GET" && url.pathname === "/state") {
      return json(current ?? null);
    }
    if (request.method === "GET" && url.pathname === "/stop-state") {
      const requested = await this.state.storage.get<boolean>(STOP_REQUESTED_KEY);
      return json({ requested: requested === true });
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const time = Date.now();
    const now = new Date(time).toISOString();
    if (url.pathname === "/stop") {
      await this.state.storage.put(STOP_REQUESTED_KEY, true);
      await this.state.storage.setAlarm(time + RETENTION_MS);
      return json({ requested: true });
    }

    if (url.pathname === "/claim") {
      const payload = (await request.json()) as { token?: unknown };
      const token = payload.token;
      if (typeof token !== "string" || !/^[0-9a-f-]{36}$/iu.test(token)) {
        return json({ error: "invalid_claim_token" }, 400);
      }
      if (current && terminal(current.status)) return json({ outcome: "terminal", state: current });

      if (current?.status === "sending") {
        if (current.claim && current.claim.expiresAt > time) {
          return json({ outcome: "busy", state: current });
        }
        // A send started, but its result is unknown. Never replay it.
        const next: TelegramUpdateRecord = {
          ...current, status: "ambiguous", claim: undefined, updatedAt: now,
          detail: "stale or interrupted Telegram send",
        };
        await this.state.storage.put(RECORD_KEY, next);
        await this.state.storage.setAlarm(time + RETENTION_MS);
        return json({ outcome: "uncertain", state: next });
      }
      if (current?.claim && current.claim.expiresAt > time) {
        return json({ outcome: "busy", state: current });
      }
      const next: TelegramUpdateRecord = {
        ...current,
        status: current?.reply ? "prepared" : "preparing",
        claim: { token, expiresAt: time + CLAIM_LEASE_MS },
        updatedAt: now,
      };
      await this.state.storage.put(RECORD_KEY, next);
      await this.state.storage.setAlarm(time + RETENTION_MS);
      return json({ outcome: "claimed", state: next });
    }

    const token = request.headers.get("x-claim-token");
    if (!current || !token || current.claim?.token !== token || current.claim.expiresAt <= time) {
      return json({ error: "claim_not_owned" }, 409);
    }
    if (terminal(current.status)) return json({ error: "already_terminal" }, 409);

    if (url.pathname === "/prepare") {
      if (current.status !== "preparing" && current.status !== "prepared") {
        return json({ error: "not_preparing" }, 409);
      }
      const payload = (await request.json()) as { reply?: TelegramReply };
      if (!payload.reply) return json({ error: "missing_reply" }, 400);
      // The first durable reply wins, even if the worker restarts before sending.
      const next: TelegramUpdateRecord = {
        ...current, status: "prepared", reply: current.reply ?? payload.reply, updatedAt: now,
      };
      await this.state.storage.put(RECORD_KEY, next);
      return json(next, 201);
    }
    if (url.pathname === "/sending") {
      if (current.status !== "prepared" || !current.reply) {
        return json({ error: "not_prepared" }, 409);
      }
      const next: TelegramUpdateRecord = { ...current, status: "sending", updatedAt: now };
      await this.state.storage.put(RECORD_KEY, next);
      return json(next);
    }
    if (url.pathname === "/retry" || url.pathname === "/release") {
      if (url.pathname === "/retry" ? current.status !== "sending" : current.status === "sending") {
        return json({ error: "invalid_release_phase" }, 409);
      }
      const next: TelegramUpdateRecord = {
        ...current, status: current.reply ? "prepared" : "preparing",
        claim: undefined, updatedAt: now,
      };
      await this.state.storage.put(RECORD_KEY, next);
      return json(next);
    }
    if (url.pathname === "/sent" || url.pathname === "/failed" || url.pathname === "/ambiguous") {
      const status = url.pathname.slice(1) as "sent" | "failed" | "ambiguous";
      // "sent" without a reply represents an ignored update, never a Telegram send.
      if (current.status !== "sending" && !(status === "sent" && current.status === "preparing" && !current.reply)) {
        return json({ error: "invalid_terminal_phase" }, 409);
      }
      const detail = request.headers.get("x-detail")?.slice(0, 240);
      const next: TelegramUpdateRecord = {
        status,
        reply: current.reply,
        claim: undefined,
        updatedAt: now,
        ...(detail ? { detail } : {}),
      };
      await this.state.storage.put(RECORD_KEY, next);
      await this.state.storage.setAlarm(time + RETENTION_MS);
      return json(next);
    }

    return json({ error: "not_found" }, 404);
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}
