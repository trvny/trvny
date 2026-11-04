import type { GitHubInstallationClient } from '../../../core/github-app.ts';

export const FEEDSEEK_REPOSITORY = 'trvny/feedseek';

const WORKFLOW = 'update-feeds.yml';
const REF = 'main';
const STALE_AFTER_MS = 150 * 60_000;
const RUNS_PATH = `/repos/${FEEDSEEK_REPOSITORY}/actions/workflows/${WORKFLOW}/runs?branch=${REF}&per_page=10`;
const DISPATCH_PATH = `/repos/${FEEDSEEK_REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`;
const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'pending', 'requested']);

export type FeedseekWatchdogDecision = 'active' | 'recent' | 'dispatch';

export function assessFeedseekRuns(data: unknown, nowMs: number): FeedseekWatchdogDecision {
  if (
    !Number.isFinite(nowMs) ||
    typeof data !== 'object' ||
    data === null ||
    !('workflow_runs' in data) ||
    !Array.isArray(data.workflow_runs) ||
    data.workflow_runs.length === 0
  ) {
    throw new Error('feedseek_watchdog_invalid_runs');
  }

  let newest = -Infinity;
  for (const run of data.workflow_runs as unknown[]) {
    if (typeof run !== 'object' || run === null || !('status' in run)) {
      throw new Error('feedseek_watchdog_invalid_run');
    }
    if (typeof run.status !== 'string') throw new Error('feedseek_watchdog_invalid_run');
    if (ACTIVE.has(run.status)) return 'active';
    if (run.status !== 'completed') throw new Error('feedseek_watchdog_unknown_run_status');

    if (!('run_started_at' in run) || typeof run.run_started_at !== 'string') {
      throw new Error('feedseek_watchdog_invalid_run');
    }
    const started = Date.parse(run.run_started_at);
    if (!Number.isFinite(started)) throw new Error('feedseek_watchdog_invalid_timestamp');
    // A long-running job finishing recently also counts as fresh.
    let recent = started;
    if ('updated_at' in run) {
      if (typeof run.updated_at !== 'string') throw new Error('feedseek_watchdog_invalid_timestamp');
      const updated = Date.parse(run.updated_at);
      if (!Number.isFinite(updated)) throw new Error('feedseek_watchdog_invalid_timestamp');
      recent = Math.max(recent, updated);
    }
    newest = Math.max(newest, recent);
  }
  // Clock skew or a future-dated run must never force a dispatch.
  return nowMs - newest >= STALE_AFTER_MS ? 'dispatch' : 'recent';
}

export async function checkFeedseekWatchdog(
  github: GitHubInstallationClient,
  nowMs = Date.now(),
): Promise<FeedseekWatchdogDecision> {
  if (github.permissions.actions !== 'write') {
    throw new Error('feedseek_watchdog_actions_write_required');
  }

  const runs = await github.json<unknown>(RUNS_PATH, 'feedseek_watchdog_runs');
  const decision = assessFeedseekRuns(runs, nowMs);
  if (decision === 'dispatch') {
    await github.void(DISPATCH_PATH, 'feedseek_watchdog_dispatch', {
      method: 'POST',
      body: JSON.stringify({ ref: REF }),
    });
  }
  console.info('feedseek_watchdog', { decision });
  return decision;
}
