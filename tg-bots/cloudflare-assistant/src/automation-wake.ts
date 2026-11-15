import type { Env } from "./types";

export const AUTOMATION_KINDS = ["tasks", "reminders", "watches"] as const;
export type AutomationKind = typeof AUTOMATION_KINDS[number];

async function requestScheduler(env: Env, kind: AutomationKind, operation: string, at?: number): Promise<void> {
  const ns = env.TELEGRAM_AUTOMATION_SCHEDULER;
  if (!ns) return;
  const response = await ns.get(ns.idFromName(kind)).fetch(`https://automation-scheduler/${operation}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind, at }),
  });
  if (!response.ok) throw new Error(`automation ${kind} ${operation}: HTTP ${response.status}`);
}

export async function wakeAutomation(env: Env, kind: AutomationKind, at: number): Promise<void> {
  // The record is already durable. Hourly reconciliation repairs failed wakes.
  await requestScheduler(env, kind, "wake", at).catch((error: unknown) => {
    console.warn("Automation wake failed", kind, error);
  });
}

export async function reconcileAutomations(env: Env): Promise<void> {
  const results = await Promise.allSettled(AUTOMATION_KINDS.map((kind) =>
    requestScheduler(env, kind, "reconcile")));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    console.error("Automation reconciliation failed", failures.map((result) => result.reason));
  }
}
