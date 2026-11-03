import { miniAppOwnerAuthError } from "./mini-app.ts";
import { cancelReminder, listReminders } from "./reminders.ts";
import { cancelConditionWatch, listConditionWatches, type ConditionWatch } from "./watches.ts";
import type { Env } from "./types";

const REMINDER_ID = /^r[0-9a-z]{1,16}$/u;
const WATCH_ID = /^w[0-9a-z]{1,16}$/u;
type AutomationKind = "reminders" | "watches";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function publicWatch(watch: Exclude<ConditionWatch, { kind: "secretary" }>) {
  const target = watch.kind === "github"
    ? `${watch.repository}#${watch.number} · ${watch.condition}`
    : watch.kind === "feedseek"
      ? watch.query
      : `Legion ${watch.condition}`;
  return {
    id: watch.id,
    kind: watch.kind,
    target,
    status: watch.status,
    nextCheckAt: watch.nextCheckAt,
  };
}

export async function handleMiniAppAutomationListRequest(
  request: Request,
  env: Env,
  nowMs = Date.now(),
): Promise<Response> {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  const authError = await miniAppOwnerAuthError(request, env, nowMs);
  if (authError) return authError;

  try {
    const [reminders, watches] = await Promise.all([listReminders(env), listConditionWatches(env)]);
    return json({
      ok: true,
      reminders: reminders.map(({ id, text, dueAt, state }) => ({ id, text, dueAt, state })),
      watches: watches
        .filter((watch): watch is Exclude<ConditionWatch, { kind: "secretary" }> => watch.kind !== "secretary")
        .map(publicWatch),
    });
  } catch (error) {
    console.error("Mini App automation list failed", error);
    return json({ error: "automations_unavailable" }, 503);
  }
}

export async function handleMiniAppAutomationCancelRequest(
  request: Request,
  env: Env,
  kind: string,
  id: string,
  nowMs = Date.now(),
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authError = await miniAppOwnerAuthError(request, env, nowMs);
  if (authError) return authError;
  if (!(kind === "reminders" && REMINDER_ID.test(id) || kind === "watches" && WATCH_ID.test(id))) {
    return json({ error: "invalid_automation" }, 400);
  }

  try {
    if (kind === "watches") {
      const watches = await listConditionWatches(env);
      if (!watches.some((watch) => watch.id === id && watch.kind !== "secretary")) {
        return json({ error: "not_found" }, 404);
      }
    }
    const removed = kind === "reminders"
      ? await cancelReminder(env, id)
      : await cancelConditionWatch(env, id);
    return removed ? json({ ok: true, removed: true }) : json({ error: "not_found" }, 404);
  } catch (error) {
    console.error("Mini App automation cancellation failed", error);
    return json({ error: "automations_unavailable" }, 503);
  }
}
