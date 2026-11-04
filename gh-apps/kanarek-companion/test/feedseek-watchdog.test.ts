import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type { GitHubInstallationClient } from '../../core/github-app.ts';
import {
  assessFeedseekRuns,
  checkFeedseekWatchdog,
} from '../src/specialists/feedseek-watchdog.ts';

const NOW = Date.parse('2026-11-04T21:15:00Z');
const MINUTE = 60_000;

function feedRuns(ageMinutes: number, status = 'completed') {
  return {
    workflow_runs: [
      {
        status,
        created_at: new Date(NOW - (ageMinutes + 180) * MINUTE).toISOString(),
        run_started_at: new Date(NOW - ageMinutes * MINUTE).toISOString(),
      },
    ],
  };
}

test('watchdog skips recent, future and active generator runs', () => {
  assert.equal(assessFeedseekRuns(feedRuns(149), NOW), 'recent');
  assert.equal(assessFeedseekRuns(feedRuns(-1), NOW), 'recent');
  assert.equal(assessFeedseekRuns(feedRuns(151, 'queued'), NOW), 'active');
  assert.equal(assessFeedseekRuns(feedRuns(600, 'in_progress'), NOW), 'active');
  assert.equal(assessFeedseekRuns(feedRuns(600, 'waiting'), NOW), 'active');
  assert.equal(assessFeedseekRuns(feedRuns(600), NOW), 'dispatch');
  assert.equal(assessFeedseekRuns(feedRuns(150), NOW), 'dispatch');
  const longRunning = feedRuns(220);
  longRunning.workflow_runs[0] = {
    ...longRunning.workflow_runs[0],
    updated_at: new Date(NOW - 5 * MINUTE).toISOString(),
  };
  assert.equal(assessFeedseekRuns(longRunning, NOW), 'recent');
});

test('watchdog considers all recent runs, not just the first entry', () => {
  const data = {
    workflow_runs: [
      feedRuns(400).workflow_runs[0],
      feedRuns(10).workflow_runs[0],
    ],
  };
  assert.equal(assessFeedseekRuns(data, NOW), 'recent');
  data.workflow_runs.push(feedRuns(400, 'pending').workflow_runs[0]);
  assert.equal(assessFeedseekRuns(data, NOW), 'active');
});

test('invalid or empty GitHub data fails closed', () => {
  for (const value of [
    null,
    {},
    { workflow_runs: [] },
    { workflow_runs: [{ status: 'completed', run_started_at: 'broken' }] },
    { workflow_runs: [{ status: 'completed', created_at: new Date(NOW).toISOString() }] },
    { workflow_runs: [{ status: 'new', run_started_at: new Date(NOW).toISOString() }] },
  ]) {
    assert.throws(() => assessFeedseekRuns(value, NOW), /feedseek_watchdog/);
  }
});

test('only stale runs dispatch, and the target is fixed', async () => {
  const calls: string[] = [];
  const github = {
    permissions: { actions: 'write' },
    json(path: string) {
      calls.push(`GET ${path}`);
      return Promise.resolve(feedRuns(151));
    },
    void(path: string, operation: string, init: RequestInit) {
      calls.push(`${init.method} ${path}`);
      assert.equal(operation, 'feedseek_watchdog_dispatch');
      assert.deepEqual(JSON.parse(String(init.body)), { ref: 'main' });
      return Promise.resolve();
    },
  } as unknown as GitHubInstallationClient;
  assert.equal(await checkFeedseekWatchdog(github, NOW), 'dispatch');
  assert.deepEqual(calls, [
    'GET /repos/trvny/feedseek/actions/workflows/update-feeds.yml/runs?branch=main&per_page=10',
    'POST /repos/trvny/feedseek/actions/workflows/update-feeds.yml/dispatches',
  ]);
});

test('recent runs and missing permissions never dispatch', async () => {
  let dispatched = 0;
  const client = {
    permissions: { actions: 'write' },
    json() { return Promise.resolve(feedRuns(100)); },
    void() { dispatched += 1; return Promise.resolve(); },
  } as unknown as GitHubInstallationClient;
  assert.equal(await checkFeedseekWatchdog(client, NOW), 'recent');
  assert.equal(dispatched, 0);

  const missingPermission = {
    permissions: { actions: 'read' },
    json() { return Promise.reject(new Error('must not read')); },
    void() { dispatched += 1; return Promise.resolve(); },
  } as unknown as GitHubInstallationClient;
  await assert.rejects(() => checkFeedseekWatchdog(missingPermission, NOW), /actions_write_required/);
  assert.equal(dispatched, 0);
});

test('production cron is only configured in Wrangler', () => {
  const config = JSON.parse(
    readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'),
  ) as { triggers?: { crons?: string[] } };
  assert.deepEqual(config.triggers?.crons, ['15 * * * *']);
});
