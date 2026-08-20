import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPullRequestSnapshot,
  maintenanceDelta,
} from '../src/autopilot-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

const CANDIDATE = {
  repository: 'trvny/feedseek',
  number: 42,
  headSha: 'a'.repeat(40),
  title: 'Feed the machine',
  draft: false,
};

test('operator autopilot is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  const autopilot = operations.find((operation) => operation.operationId === 'runOperatorAutopilot');

  assert.ok(autopilot);
  assert.ok(!autopilot.description || autopilot.description.length <= 300);
});

test('pull request classification distinguishes ready, reviews and pending CI', () => {
  const ready = classifyPullRequestSnapshot(CANDIDATE, {
    state: 'open',
    draft: false,
    mergeable: true,
    ciState: 'success',
    unresolvedThreads: 0,
    activeChangeRequests: 0,
  });
  assert.equal(ready.kind, 'pull_request_ready_candidate');
  assert.equal(ready.nextAction, 'finalizePullRequest');
  assert.equal(ready.semanticReviewRequired, true);

  const reviewBlocked = classifyPullRequestSnapshot(CANDIDATE, {
    state: 'open',
    draft: false,
    mergeable: true,
    ciState: 'success',
    unresolvedThreads: 1,
    activeChangeRequests: 0,
  });
  assert.equal(reviewBlocked.kind, 'pull_request_review_blocked');
  assert.equal(reviewBlocked.unresolvedThreads, 1);

  const pending = classifyPullRequestSnapshot(CANDIDATE, {
    state: 'open',
    draft: false,
    mergeable: true,
    ciState: 'pending',
    unresolvedThreads: 0,
    activeChangeRequests: 0,
  });
  assert.equal(pending.kind, 'pull_request_ci_pending');
  assert.equal(pending.waitForCompletion, true);
});

test('maintenance delta reports verified movement', () => {
  const before = {
    summary: {
      unattachedBranches: 4,
      problemWorkflowRuns: 2,
      pendingWorkflowRuns: 0,
      activeCacheBytes: 1000,
      repositoriesWithAttention: 3,
      partialRepositories: 1,
    },
  };
  const after = {
    summary: {
      unattachedBranches: 1,
      problemWorkflowRuns: 0,
      pendingWorkflowRuns: 1,
      activeCacheBytes: 400,
      repositoriesWithAttention: 1,
      partialRepositories: 1,
    },
  };

  assert.deepEqual(maintenanceDelta(before, after), {
    unattachedBranches: -3,
    problemWorkflowRuns: -2,
    pendingWorkflowRuns: 1,
    activeCacheBytes: -600,
    repositoriesWithAttention: -2,
    partialRepositories: 0,
  });
});
