import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCodeChangeAutopilotOpenApi,
  reviewGateBlockers,
} from '../src/code-change-orchestration.ts';

test('code-change autopilot exposes implementCodeChange', () => {
  const document: Record<string, any> = { paths: {} };
  addCodeChangeAutopilotOpenApi(document);
  assert.equal(
    document.paths['/gpt-actions/operator/code-change'].post.operationId,
    'implementCodeChange',
  );
});

test('review gate requires exact reviewed head and successful final CI', () => {
  const head = 'a'.repeat(40);
  assert.deepEqual(
    reviewGateBlockers(
      {
        state: 'open',
        draft: false,
        headSha: head,
        mergeable: true,
        ciState: 'success',
        unresolvedThreads: 0,
        activeChangeRequests: 0,
      },
      head,
    ),
    [],
  );

  assert.deepEqual(
    reviewGateBlockers(
      {
        state: 'open',
        draft: false,
        headSha: 'b'.repeat(40),
        mergeable: true,
        ciState: 'none',
        unresolvedThreads: 2,
        activeChangeRequests: 1,
      },
      head,
    ),
    ['head_changed', 'ci:none', 'unresolved_threads:2', 'changes_requested:1'],
  );
});

test('review gate blocks unknown mergeability and pending CI', () => {
  const head = 'c'.repeat(40);
  assert.deepEqual(
    reviewGateBlockers(
      {
        state: 'open',
        draft: false,
        headSha: head,
        mergeable: null,
        ciState: 'pending',
        unresolvedThreads: 0,
        activeChangeRequests: 0,
      },
      head,
    ),
    ['mergeability_unknown', 'ci:pending'],
  );
});
