import type { DurableObjectStateLike, Env } from "./types.ts";

const GRANT_RETENTION_MS = 60 * 60_000;
const MAX_GRANTS = 768;

type RateState = {
  start: number;
  count: number;
  last: number;
  lastUpdateId: number;
  grants?: Array<{ id: number; at: number }>;
};

export class TelegramPublicRateGate {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/allow") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const body = await request.json() as { now?: unknown; updateId?: unknown };
    if (typeof body.now !== "number" || !Number.isSafeInteger(body.now) || body.now < 0 ||
      typeof body.updateId !== "number" || !Number.isSafeInteger(body.updateId) || body.updateId < 0) {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    const now = body.now;
    const stored = await this.state.storage.get<RateState>("window");
    // Public retries remain idempotent even after newer updates from the same actor.
    const grants = (stored?.grants ?? []).filter((grant) =>
      Number.isSafeInteger(grant.id) && grant.at <= now &&
      now - grant.at < GRANT_RETENTION_MS
    );
    if (stored?.lastUpdateId === body.updateId ||
        grants.some((grant) => grant.id === body.updateId)) {
      return Response.json({ allowed: true });
    }
    const current = stored && now >= stored.start && now - stored.start < 60_000
      ? stored : { start: now, count: 0, last: -2_000, lastUpdateId: -1 };
    if (current.count >= 12 || now - current.last < 1_250) return Response.json({ allowed: false });
    await this.state.storage.put("window", {
      start: current.start,
      count: current.count + 1,
      last: now,
      lastUpdateId: body.updateId,
      grants: [...grants, { id: body.updateId, at: now }].slice(-MAX_GRANTS),
    } satisfies RateState);
    await this.state.storage.setAlarm(now + GRANT_RETENTION_MS);
    return Response.json({ allowed: true });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

// Public actions use the same queue dedup semantics as all Telegram updates.

export async function allowPublicCommand(env: Env, senderId: number, updateId: number): Promise<boolean> {
  const gate = env.TELEGRAM_PUBLIC_GATE;
  const instance = gate.get(gate.idFromName(String(senderId)));
  const response = await instance.fetch("https://botek-rate/allow", {
    method: "POST",
    body: JSON.stringify({ updateId, now: Date.now() }),
  });
  if (!response.ok) return false;
  const result = await response.json() as { allowed: boolean };
  return result.allowed;
}
