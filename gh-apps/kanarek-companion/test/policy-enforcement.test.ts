import assert from 'node:assert/strict';
import test from 'node:test';

import {
  effectiveAutofixLimits,
  filterAccountMaintenancePayload,
  repositoryAllowedByPolicy,
} from '../src/policy-enforcement.ts';
import type {
  GremlinPolicy,
  LoadedGremlinPolicy,
} from '../src/policy-actions.ts';

function policy(): GremlinPolicy {
  return {
    version: 1,
    model: {
      autonomy: 'high',
      operatingMode: 'act_then_report',
      stopConditions: ['missing_credentials_or_permissions'],
      preferredActions: ['getOperatorBootstrap'],
    },
    runtime: {
      repositories: {
        include: ['trvny/*'],
        exclude: ['trvny/ignored'],
        skipArchived: true,
      },
      maintenance: {
        autofix: true,
        maxRepositoriesPerRun: 6,
        maxFixesPerRun: 9,
        workflowRetries: 1,
      },
      merge: {
        enabled: true,
        method: 'squash',
        requireGreenCi: true,
        requireNoActionableReviews: true,
        requireExpectedHeadSha: true,
      },
      release: {
        allowedBranches: ['main'],
        requireExpectedTargetSha: true,
      },
    },
  };
}

function repository(name: string, overrides: Record<string, unknown> = {}) {
  return {
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
  };
}

test('repository policy uses include first and exclude wins', () => {
  const value = policy();
  assert.equal(repositoryAllowedByPolicy(value, 'trvny/feedseek'), true);
  assert.equal(repositoryAllowedByPolicy(value, 'trvny/ignored'), false);
  assert.equal(repositoryAllowedByPolicy(value, 'other/repo'), false);
});

test('autofix limits are capped by private policy and hard runtime ceilings', () => {
  const value = policy();
  assert.deepEqual(effectiveAutofixLimits(value, null), {
    maxRepositories: 6,
    maxActions: 9,
  });
  assert.deepEqual(effectiveAutofixLimits(value, 4), {
    maxRepositories: 6,
    maxActions: 4,
  });

  value.runtime.maintenance.maxRepositoriesPerRun = 20;
  value.runtime.maintenance.maxFixesPerRun = 50;
  assert.deepEqual(effectiveAutofixLimits(value, null), {
    maxRepositories: 8,
    maxActions: 20,
  });
});

test('account maintenance payload is filtered and re-summarized by policy', () => {
  const loaded: LoadedGremlinPolicy = {
    policy: policy(),
    source: {
      repository: 'trvny/trvny',
      path: '.ai/private/openai/gremlin-policy.json',
      ref: 'main',
      sha: 'a'.repeat(40),
    },
  };
  const result = filterAccountMaintenancePayload(
    {
      ok: true,
      scannedCount: 3,
      repositories: [
        repository('trvny/feedseek', {
          workflows: {
            listedCount: 1,
            problemCount: 1,
            pendingCount: 0,
            recentProblemRuns: [],
            pendingRuns: [],
          },
          attention: ['workflow_problems'],
        }),
        repository('trvny/ignored'),
        repository('trvny/archive', { archived: true }),
      ],
      summary: { repositoriesWithAttention: 99 },
    },
    loaded,
  );

  assert.equal(result.scannedCount, 1);
  assert.deepEqual(result.policyExcluded, ['trvny/ignored', 'trvny/archive']);
  assert.deepEqual(
    (result.repositories as Array<{ name: string }>).map((entry) => entry.name),
    ['trvny/feedseek'],
  );
  assert.deepEqual(result.summary, {
    openPullRequests: 0,
    unattachedBranches: 0,
    problemWorkflowRuns: 1,
    pendingWorkflowRuns: 0,
    activeCacheBytes: 0,
    repositoriesWithAttention: 1,
    partialRepositories: 0,
  });
});
