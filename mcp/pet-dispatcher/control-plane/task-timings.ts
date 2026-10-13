export interface TaskTimings {
  /** createdAt -> first worker lease: queue delivery plus the worker's poll wait. */
  queuedMs: number;
  /** first worker lease -> terminal update: session open, execution, result callback. */
  runMs: number;
  totalMs: number;
}

/**
 * Stage split for a finished task. The first lease is recorded by the state store in its own key,
 * not in the task state: workers parse that state strictly, so a new field there would break
 * workers that were installed before the control plane was deployed.
 */
export function computeTimings(createdAt: string, leasedAt: string | undefined, finishedAt: string): TaskTimings | undefined {
  if (!leasedAt) return undefined;
  const created = Date.parse(createdAt);
  const leased = Date.parse(leasedAt);
  const finished = Date.parse(finishedAt);
  if (![created, leased, finished].every(Number.isFinite)) return undefined;
  const queuedMs = Math.max(0, leased - created);
  const runMs = Math.max(0, finished - leased);
  return { queuedMs, runMs, totalMs: queuedMs + runMs };
}
