import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cacheBranchFromRef,
  matchingClosedPullRequestNumber,
  workflowAutofixCandidate,
} from '../src/maintenance-autofix.ts';
import { customGptOpenApi } from '../src/router.ts';

test('maintenance autofix is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths)
    .flatMap((path) => Object.values(path))
    .filter((operation) => operation.operationId);
  const operation = operations.find((item) => item.operationId === 'runAccountMaintenanceAutofix');

  assert.ok(operation);
  assert.ok(!operation.description || operation.description.length <= 300);
});

test('cache cleanup only recognizes branch refs', () => {
  assert.equal(cacheBranchFromRef('refs/heads/main'), 'main');
  assert.equal(cacheBranchFromRef('refs/heads/feat/test'), 'feat/test');
  assert.equal(cacheBranchFromRef('refs/tags/v1.0.0'), null);
  assert.equal(cacheBranchFromRef('refs/pull/12/merge'), null);
  assert.equal(cacheBranchFromRef('refs/heads/../main'), null);
});

test('closed PR branch cleanup requires exact repository, ref and head sha', () => {
  const sha = 'a'.repeat(40);
  const pulls = [
    {
      number: 42,
      state: 'closed',
      head: { ref: 'feat/done', sha, repo: { full_name: 'trvny/feedseek' } },
    },
    {
      number: 43,
      state: 'closed',
      head: { ref: 'feat/done', sha: 'b'.repeat(40), repo: { full_name: 'trvny/feedseek' } },
    },
  ];

  assert.equal(
    matchingClosedPullRequestNumber(pulls, 'trvny/feedseek', 'feat/done', sha),
    42,
  );
  assert.equal(
    matchingClosedPullRequestNumber(pulls, 'twojstar/kanarek', 'feat/done', sha),
    null,
  );
  assert.equal(
    matchingClosedPullRequestNumber(pulls, 'trvny/feedseek', 'feat/other', sha),
    null,
  );
});

test('workflow autofix only reruns a first-attempt completed failure', () => {
  const candidate = {
    id: 100,
    status: 'completed',
    conclusion: 'failure',
    runAttempt: 1,
    headSha: 'c'.repeat(40),
  };

  assert.equal(workflowAutofixCandidate(candidate), true);
  assert.equal(workflowAutofixCandidate({ ...candidate, runAttempt: 2 }), false);
  assert.equal(workflowAutofixCandidate({ ...candidate, conclusion: 'cancelled' }), false);
  assert.equal(workflowAutofixCandidate({ ...candidate, status: 'in_progress' }), false);
  assert.equal(workflowAutofixCandidate({ ...candidate, headSha: 'short' }), false);
});
