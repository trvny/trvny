import assert from 'node:assert/strict';
import test from 'node:test';

import {
  effectiveAutofixLimits,
  effectiveMaintenancePolicy,
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
        cacheMaxBytes: 5 * 1024 * 1024 * 1024,
        cacheStaleDays: 5,
        repositoryOverrides: [],
      },
      cloudflare: {
      enabled: true,
      mutations: {
        workerRollback: true,
        pagesRollback: true,
        workerSubdomain: true,
        routeUpdate: true,
        dnsUpdate: true,
      },
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

test('repository maintenance overrides can narrow autofix and tune cache thresholds', () => {
  const value = policy();
  value.runtime.maintenance.repositoryOverrides = [
    {
      repository: 'trvny/trvny',
      autofix: false,
      workflowRetries: 0,
      cacheMaxBytes: 2 * 1024 * 1024 * 1024,
      cacheStaleDays: 10,
    },
  ];

  assert.deepEqual(effectiveMaintenancePolicy(value, 'trvny/trvny'), {
    autofix: false,
    workflowRetries: 0,
    cacheMaxBytes: 2 * 1024 * 1024 * 1024,
    cacheStaleDays: 10,
  });
  assert.deepEqual(effectiveMaintenancePolicy(value, 'trvny/feedseek'), {
    autofix: true,
    workflowRetries: 1,
    cacheMaxBytes: 5 * 1024 * 1024 * 1024,
    cacheStaleDays: 5,
  });
});

test('account maintenance payload is filtered, cache-aware and re-summarized by policy', () => {
  const value = policy();
  value.runtime.maintenance.repositoryOverrides = [
    {
      repository: 'trvny/cachey',
      cacheMaxBytes: 1024 * 1024 * 1024,
      cacheStaleDays: 7,
    },
  ];
  const loaded: LoadedGremlinPolicy = {
    policy: value,
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
      scannedCount: 4,
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
        repository('trvny/cachey', {
          cache: { activeCount: 4, activeBytes: 2 * 1024 * 1024 * 1024 },
        }),
        repository('trvny/ignored'),
        repository('trvny/archive', { archived: true }),
      ],
      summary: { repositoriesWithAttention: 99 },
    },
    loaded,
  );

  assert.equal(result.scannedCount, 2);
  assert.deepEqual(result.policyExcluded, ['trvny/ignored', 'trvny/archive']);
  const repositories = result.repositories as Array<{
    name: string;
    attention: string[];
    maintenancePolicy: { cacheMaxBytes: number; cacheStaleDays: number };
  }>;
  assert.deepEqual(repositories.map((entry) => entry.name), ['trvny/cachey', 'trvny/feedseek']);
  assert.deepEqual(repositories[0].attention, ['cache_pressure']);
  assert.equal(repositories[0].maintenancePolicy.cacheMaxBytes, 1024 * 1024 * 1024);
  assert.equal(repositories[0].maintenancePolicy.cacheStaleDays, 7);
  assert.deepEqual(result.summary, {
    openPullRequests: 0,
    unattachedBranches: 0,
    problemWorkflowRuns: 1,
    pendingWorkflowRuns: 0,
    activeCacheBytes: 2 * 1024 * 1024 * 1024,
    repositoriesWithAttention: 2,
    partialRepositories: 0,
  });
});
