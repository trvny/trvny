import type {
  DurableObjectStateLike,
  TelegramReply,
  TelegramUpdateRecord,
} from "./types";

const RECORD_KEY = "record";
const RETENTION_MS = 7 * 24 * 60 * 60_000;

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

function terminal(status: TelegramUpdateRecord["status"]): boolean {
  return status === "sent" || status === "failed" || status === "ambiguous";
}

export class TelegramUpdateDedup {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const current = await this.state.storage.get<TelegramUpdateRecord>(RECORD_KEY);

    if (request.method === "GET" && url.pathname === "/state") {
      return json(current ?? null);
    }
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const now = new Date().toISOString();
    if (url.pathname === "/prepare") {
      if (current && terminal(current.status)) return json(current);
      const payload = (await request.json()) as { reply?: TelegramReply };
      if (!payload.reply) return json({ error: "missing_reply" }, 400);
      const next: TelegramUpdateRecord = { status: "prepared", reply: payload.reply, updatedAt: now };
      await this.state.storage.put(RECORD_KEY, next);
      await this.state.storage.setAlarm(Date.now() + RETENTION_MS);
      return json(next, 201);
    }
    if (url.pathname === "/sending") {
      if (!current) return json({ error: "not_prepared" }, 409);
      if (terminal(current.status)) return json(current);
      const next: TelegramUpdateRecord = { ...current, status: "sending", updatedAt: now };
      await this.state.storage.put(RECORD_KEY, next);
      return json(next);
    }
    if (url.pathname === "/retry") {
      if (!current?.reply) return json({ error: "missing_reply" }, 409);
      if (terminal(current.status)) return json(current);
      const next: TelegramUpdateRecord = { ...current, status: "prepared", updatedAt: now };
      await this.state.storage.put(RECORD_KEY, next);
      return json(next);
    }
    if (url.pathname === "/sent" || url.pathname === "/failed" || url.pathname === "/ambiguous") {
      const status = url.pathname.slice(1) as "sent" | "failed" | "ambiguous";
      const detail = request.headers.get("x-detail")?.slice(0, 240);
      const next: TelegramUpdateRecord = {
        status,
        reply: current?.reply,
        updatedAt: now,
        ...(detail ? { detail } : {}),
      };
      await this.state.storage.put(RECORD_KEY, next);
      await this.state.storage.setAlarm(Date.now() + RETENTION_MS);
      return json(next);
    }

    return json({ error: "not_found" }, 404);
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}
