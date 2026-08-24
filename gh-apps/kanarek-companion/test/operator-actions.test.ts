import assert from 'node:assert/strict';
import test from 'node:test';

import {
  finalizeBlockers,
  summarizeCi,
  type FinalizeSnapshot,
} from '../src/operator-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

function snapshot(overrides: Partial<FinalizeSnapshot> = {}): FinalizeSnapshot {
  return {
    state: 'open',
    draft: false,
    headSha: 'a'.repeat(40),
    baseRef: 'main',
    mergeable: true,
    ciState: 'success',
    unresolvedThreads: 0,
    activeChangeRequests: 0,
    ...overrides,
  };
}

test('operator actions are exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .filter((operation) => operation.operationId);
  const ids = operations.map((operation) => operation.operationId);

  assert.ok(ids.includes('getRepositoryContext'));
  assert.ok(ids.includes('inspectPullRequest'));
  assert.ok(ids.includes('diagnoseWorkflowRun'));
  assert.ok(ids.includes('finalizePullRequest'));
  for (const operation of operations) {
    if (operation.description) assert.ok(operation.description.length <= 300);
  }
});

test('CI summary distinguishes no CI, pending, failing and green runs', () => {
  assert.equal(summarizeCi({}, {}).state, 'none');
  assert.equal(
    summarizeCi(
      { state: 'pending', statuses: [{ context: 'deploy', state: 'pending' }] },
      { check_runs: [] },
    ).state,
    'pending',
  );
  assert.equal(
    summarizeCi(
      { state: 'success', statuses: [{ context: 'deploy', state: 'success' }] },
      { check_runs: [{ name: 'test', status: 'completed', conclusion: 'failure' }] },
    ).state,
    'failure',
  );
  assert.equal(
    summarizeCi(
      { state: 'success', statuses: [{ context: 'deploy', state: 'success' }] },
      { check_runs: [{ name: 'test', status: 'completed', conclusion: 'success' }] },
    ).state,
    'success',
  );
});

test('finalize blockers enforce the expected head, base and review/CI gates', () => {
  assert.deepEqual(finalizeBlockers(snapshot(), 'a'.repeat(40), 'main'), []);
  assert.deepEqual(
    finalizeBlockers(
      snapshot({
        draft: true,
        headSha: 'b'.repeat(40),
        baseRef: 'release',
        mergeable: null,
        ciState: 'pending',
        unresolvedThreads: 2,
        activeChangeRequests: 1,
      }),
      'a'.repeat(40),
      'main',
    ),
    [
      'pull_request_is_draft',
      'head_sha_changed',
      'base_ref_changed',
      'mergeability_unknown',
      'ci_pending',
      'unresolved_review_threads',
      'changes_requested',
    ],
  );
});
