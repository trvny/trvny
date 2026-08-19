import assert from 'node:assert/strict';
import test from 'node:test';

import { unattachedBranches, workflowRunIsProblem } from '../src/maintenance-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

test('maintenance report is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .filter((operation) => operation.operationId);

  assert.ok(operations.some((operation) => operation.operationId === 'getRepositoryMaintenance'));
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
