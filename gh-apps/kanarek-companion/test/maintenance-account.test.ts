import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountMaintenanceAttention,
  type AccountRepositoryMaintenance,
  summarizeAccountMaintenance,
} from '../src/maintenance-account.ts';
import { customGptOpenApi } from '../src/router.ts';

test('account maintenance is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .filter((operation) => operation.operationId);

  const account = operations.find((operation) => operation.operationId === 'getAccountMaintenance');
  assert.ok(account);
  assert.ok((account.description?.length ?? 0) <= 300);
});

test('account maintenance attention only flags actionable or partial state', () => {
  assert.deepEqual(accountMaintenanceAttention(0, 0, 0), []);
  assert.deepEqual(accountMaintenanceAttention(2, 1, 0), [
    'workflow_problems',
    'unattached_branches',
  ]);
  assert.deepEqual(accountMaintenanceAttention(0, 0, 1), ['partial_data']);
});

test('account maintenance summary aggregates repository signals', () => {
  const repository = (
    name: string,
    overrides: Partial<AccountRepositoryMaintenance> = {},
  ): AccountRepositoryMaintenance => ({
    name,
    archived: false,
    private: false,
    defaultBranch: 'main',
    htmlUrl: null,
    pullRequests: { openCount: 0, truncated: false, items: [] },
    branches: { listedCount: 1, truncated: false, unattachedCount: 0, unattached: [] },
    workflows: {
      listedCount: 0,
      problemCount: 0,
      pendingCount: 0,
      recentProblemRuns: [],
      pendingRuns: [],
    },
    cache: { activeCount: 0, activeBytes: 0 },
    attention: [],
    errors: [],
    ...overrides,
  });

  const result = summarizeAccountMaintenance([
    repository('trvny/one', {
      pullRequests: { openCount: 2, truncated: false, items: [] },
      branches: { listedCount: 3, truncated: false, unattachedCount: 1, unattached: [] },
      workflows: {
        listedCount: 4,
        problemCount: 1,
        pendingCount: 2,
        recentProblemRuns: [],
        pendingRuns: [],
      },
      cache: { activeCount: 2, activeBytes: 1024 },
      attention: ['workflow_problems', 'unattached_branches'],
    }),
    repository('trvny/two', {
      cache: { activeCount: null, activeBytes: null },
      attention: ['partial_data'],
      errors: [{ area: 'cache' }],
    }),
  ]);

  assert.deepEqual(result, {
    openPullRequests: 2,
    unattachedBranches: 1,
    problemWorkflowRuns: 1,
    pendingWorkflowRuns: 2,
    activeCacheBytes: 1024,
    repositoriesWithAttention: 2,
    partialRepositories: 1,
  });
});
