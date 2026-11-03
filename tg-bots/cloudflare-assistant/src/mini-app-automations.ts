import { miniAppOwnerAuthError } from "./mini-app.ts";
import { cancelReminder, listReminders } from "./reminders.ts";
import { cancelConditionWatch, listConditionWatches, type ConditionWatch } from "./watches.ts";
import type { Env } from "./types";

const REMINDER_ID = /^r[0-9a-z]{1,16}$/u;
const WATCH_ID = /^w[0-9a-z]{1,16}$/u;
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
    const [reminderResult, watchResult] = await Promise.allSettled([
      listReminders(env),
      listConditionWatches(env),
    ]);
    if (reminderResult.status === "rejected" && watchResult.status === "rejected") {
      throw new Error("Both automation stores unavailable");
    }
    if (reminderResult.status === "rejected") console.warn("Mini App reminders unavailable", reminderResult.reason);
    if (watchResult.status === "rejected") console.warn("Mini App watches unavailable", watchResult.reason);
    return json({
      ok: true,
      reminders: reminderResult.status === "fulfilled"
        ? reminderResult.value.map(({ id, text, dueAt, state }) => ({ id, text, dueAt, state }))
        : null,
      watches: watchResult.status === "fulfilled"
        ? watchResult.value
          .filter((watch): watch is Exclude<ConditionWatch, { kind: "secretary" }> => watch.kind !== "secretary")
          .map(publicWatch)
        : null,
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
