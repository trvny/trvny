import type { DurableObjectStateLike, Env } from "./types.ts";

type RateState = { start: number; count: number; last: number; lastUpdateId: number };

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
    if (stored?.lastUpdateId === body.updateId) return Response.json({ allowed: true });
    const current = stored && now >= stored.start && now - stored.start < 60_000
      ? stored : { start: now, count: 0, last: -2_000, lastUpdateId: -1 };
    if (current.count >= 12 || now - current.last < 1_250) return Response.json({ allowed: false });
    await this.state.storage.put("window", {
      start: current.start, count: current.count + 1, last: now, lastUpdateId: body.updateId,
    } satisfies RateState);
    await this.state.storage.setAlarm(now + 60_000);
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
