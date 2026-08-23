import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCodeChangeAutopilotOpenApi,
  reviewGateBlockers,
} from '../src/code-change-orchestration.ts';

test('code-change autopilot exposes implementCodeChange with stage action contracts', () => {
  const document: Record<string, any> = { paths: {} };
  addCodeChangeAutopilotOpenApi(document);
  const operation = document.paths['/gpt-actions/operator/code-change'].post;
  assert.equal(operation.operationId, 'implementCodeChange');
  const variants = operation.requestBody.content['application/json'].schema.properties.action.oneOf;
  assert.deepEqual(variants.map((entry: Record<string, any>) => entry.properties.type.enum[0]), [
    'edit',
    'verification',
    'review',
  ]);
  const verification = variants[1];
  assert.deepEqual(verification.required, ['type', 'status', 'headSha', 'revision']);
  assert.deepEqual(verification.properties.results.items.required, ['status', 'cwd', 'command']);
  assert.deepEqual(verification.properties.results.items.properties.status.enum, ['passed', 'failed']);
});

test('review gate requires exact base, reviewed head and successful final CI', () => {
  const head = 'a'.repeat(40);
  assert.deepEqual(
    reviewGateBlockers(
      {
        state: 'open',
        baseRef: 'main',
        draft: false,
        headSha: head,
        mergeable: true,
        ciState: 'success',
        unresolvedThreads: 0,
        activeChangeRequests: 0,
      },
      head,
      'main',
    ),
    [],
  );

  assert.deepEqual(
    reviewGateBlockers(
      {
        state: 'open',
        baseRef: 'release',
        draft: false,
        headSha: 'b'.repeat(40),
        mergeable: true,
        ciState: 'none',
        unresolvedThreads: 2,
        activeChangeRequests: 1,
      },
      head,
      'main',
    ),
    ['base_changed:release', 'head_changed', 'ci:none', 'unresolved_threads:2', 'changes_requested:1'],
  );
});

test('review gate blocks unknown mergeability and pending CI', () => {
  const head = 'c'.repeat(40);
  assert.deepEqual(
    reviewGateBlockers(
      {
        state: 'open',
        baseRef: 'main',
        draft: false,
        headSha: head,
        mergeable: null,
        ciState: 'pending',
        unresolvedThreads: 0,
        activeChangeRequests: 0,
      },
      head,
      'main',
    ),
    ['mergeability_unknown', 'ci:pending'],
  );
});
