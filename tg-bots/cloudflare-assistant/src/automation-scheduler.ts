import { AUTOMATION_KINDS, type AutomationKind } from "./automation-wake.ts";
import { listReminders } from "./reminders.ts";
import { pendingTaskWatches } from "./task-watch.ts";
import { listConditionWatches } from "./watches.ts";
import type { DurableObjectStorageLike, Env } from "./types";

const KIND_KEY = "automation-kind";
const TASK_POLL_MS = 120_000;
const RETRY_MS = 30_000;

export type SchedulerState = {
  storage: DurableObjectStorageLike & { getAlarm(): Promise<number | null> };
};

function validKind(value: unknown): value is AutomationKind {
  return AUTOMATION_KINDS.some((kind) => kind === value);
}

export async function nextAutomationAt(env: Env, kind: AutomationKind, now = Date.now()): Promise<number | null> {
  if (kind === "tasks") return (await pendingTaskWatches(env)).length ? now + TASK_POLL_MS : null;
  const dates = kind === "reminders"
    ? (await listReminders(env)).filter((item) => item.state === "pending").map((item) => Date.parse(item.dueAt))
    : (await listConditionWatches(env)).flatMap((item) => {
        if (item.status === "active") return [Date.parse(item.nextCheckAt)];
        if (item.status === "checking") return [item.leaseUntil ? Date.parse(item.leaseUntil) : now];
        // Do not retry ambiguous sending states.
        return [];
      });
  const valid = dates.filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : null;
}

export class AutomationScheduler {
  constructor(
    private readonly state: SchedulerState,
    private readonly env: Env,
    private readonly runDuty: (env: Env, kind: AutomationKind) => Promise<void>,
  ) {}

  private async armEarlier(at: number): Promise<void> {
    const current = await this.state.storage.getAlarm();
    const next = Math.max(Date.now() + 1, at);
    if (current === null || next < current) await this.state.storage.setAlarm(next);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method !== "POST" || !["/wake", "/reconcile"].includes(path)) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    const body = await request.json() as { kind?: unknown; at?: unknown } | null;
    if (!body || !validKind(body.kind)) return Response.json({ error: "invalid_kind" }, { status: 400 });
    if (path === "/wake" && (typeof body.at !== "number" || !Number.isFinite(body.at))) {
      return Response.json({ error: "invalid_deadline" }, { status: 400 });
    }
    const kind = body.kind;
    const stored = await this.state.storage.get<AutomationKind>(KIND_KEY);
    if (stored && stored !== kind) return Response.json({ error: "kind_conflict" }, { status: 409 });
    if (!stored) await this.state.storage.put(KIND_KEY, kind);
    const at = path === "/wake" ? body.at as number : await nextAutomationAt(this.env, kind);
    if (at !== null) await this.armEarlier(at);
    return Response.json({ ok: true });
  }

  async alarm(): Promise<void> {
    const kind = await this.state.storage.get<AutomationKind>(KIND_KEY);
    if (!validKind(kind)) return;
    try {
      await this.runDuty(this.env, kind);
      const now = Date.now();
      const next = await nextAutomationAt(this.env, kind, now);
      // Avoid tight loops on failed sends or a backlog. Preserve earlier concurrent wakes.
      if (next !== null) await this.armEarlier(next <= now ? now + RETRY_MS : next);
    } catch (error: unknown) {
      console.error("Automation alarm failed", kind, error);
      // If storage fails too, let the platform retry the thrown alarm.
      await this.armEarlier(Date.now() + RETRY_MS);
    }
  }
}
