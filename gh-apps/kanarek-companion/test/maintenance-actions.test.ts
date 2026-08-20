import assert from 'node:assert/strict';
import test from 'node:test';

import {
  artifactCleanupMatches,
  cacheCleanupMatches,
  unattachedBranches,
  workflowRunIsProblem,
} from '../src/maintenance-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

test('maintenance report and cleanup actions are exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .filter((operation) => operation.operationId);
  const ids = operations.map((operation) => operation.operationId);

  assert.ok(ids.includes('getRepositoryMaintenance'));
  assert.ok(ids.includes('deleteMaintenanceArtifact'));
  assert.ok(ids.includes('deleteMaintenanceCache'));
  for (const operation of operations) {
    if (operation.description) assert.ok(operation.description.length <= 300);
  }
});

test('unattached branches exclude default, control and branches with open PRs', () => {
  const branches = [
    { name: 'main', commit: { sha: 'a' }, protected: false },
    { name: 'gptomek/control', commit: { sha: 'b' }, protected: false },
    { name: 'feat/active', commit: { sha: 'c' }, protected: false },
    { name: 'feat/orphan', commit: { sha: 'd' }, protected: false },
  ];
  const pulls = [
    { head: { ref: 'feat/active', repo: { full_name: 'trvny/trvny' } } },
    { head: { ref: 'feat/orphan', repo: { full_name: 'someone/fork' } } },
  ];

  assert.deepEqual(unattachedBranches(branches, pulls, 'trvny/trvny', 'main'), [
    { name: 'feat/orphan', headSha: 'd', protected: false },
  ]);
});

test('maintenance problems exclude successful, neutral and skipped workflow runs', () => {
  assert.equal(workflowRunIsProblem({ status: 'completed', conclusion: 'failure' }), true);
  assert.equal(workflowRunIsProblem({ status: 'completed', conclusion: 'cancelled' }), true);
  assert.equal(workflowRunIsProblem({ status: 'completed', conclusion: 'success' }), false);
  assert.equal(workflowRunIsProblem({ status: 'completed', conclusion: 'neutral' }), false);
  assert.equal(workflowRunIsProblem({ status: 'completed', conclusion: 'skipped' }), false);
  assert.equal(workflowRunIsProblem({ status: 'in_progress', conclusion: null }), false);
});

test('artifact cleanup requires an exact snapshot match', () => {
  const artifact = { id: 42, name: 'android-apk', size_in_bytes: 1234 };
  assert.equal(artifactCleanupMatches(artifact, 42, 'android-apk', 1234), true);
  assert.equal(artifactCleanupMatches(artifact, 42, 'android-apk', 1235), false);
  assert.equal(artifactCleanupMatches(artifact, 42, 'renamed', 1234), false);
  assert.equal(artifactCleanupMatches(artifact, 43, 'android-apk', 1234), false);
});

test('cache cleanup requires an exact id, key and ref match', () => {
  const cache = {
    id: 7,
    key: 'npm-linux-v3',
    ref: 'refs/heads/main',
    last_accessed_at: '2026-08-10T12:00:00Z',
  };
  assert.equal(cacheCleanupMatches(cache, 7, 'npm-linux-v3', 'refs/heads/main'), true);
  assert.equal(cacheCleanupMatches(cache, 8, 'npm-linux-v3', 'refs/heads/main'), false);
  assert.equal(cacheCleanupMatches(cache, 7, 'npm-linux-v2', 'refs/heads/main'), false);
  assert.equal(cacheCleanupMatches(cache, 7, 'npm-linux-v3', 'refs/heads/dev'), false);
  assert.equal(
    cacheCleanupMatches(
      cache,
      7,
      'npm-linux-v3',
      'refs/heads/main',
      '2026-08-10T12:00:00Z',
    ),
    true,
  );
  assert.equal(
    cacheCleanupMatches(
      { ...cache, last_accessed_at: '2026-08-21T00:00:00Z' },
      7,
      'npm-linux-v3',
      'refs/heads/main',
      '2026-08-10T12:00:00Z',
    ),
    false,
  );
});
