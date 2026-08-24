import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCodeChangeAutopilotOpenApi,
  commitProvenanceMatches,
  decodeContent,
  operationCommitMessage,
  recoveredChangedPathsAllowed,
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
  const edit = variants[0];
  assert.deepEqual(edit.required, ['type', 'headSha', 'revision', 'message', 'files']);
  assert.equal(edit.properties.revision.minimum, 0);
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


test('recovered commits may omit unchanged submitted paths but not add extra paths', () => {
  assert.equal(recoveredChangedPathsAllowed(['a.ts'], ['a.ts', 'unchanged.ts']), true);
  assert.equal(recoveredChangedPathsAllowed([], ['unchanged.ts']), true);
  assert.equal(recoveredChangedPathsAllowed(['a.ts', 'surprise.ts'], ['a.ts']), false);
  assert.equal(recoveredChangedPathsAllowed(['a.ts', 'a.ts'], ['a.ts']), false);
});

test('commit provenance binds recovery to operation id and input hash', () => {
  const hash = 'b'.repeat(64);
  const message = operationCommitMessage('fix: example', 'op-example123', hash);
  assert.equal(commitProvenanceMatches(message, 'op-example123', hash), true);
  assert.equal(commitProvenanceMatches(message, 'op-other1234', hash), false);
  assert.equal(commitProvenanceMatches(message, 'op-example123', 'c'.repeat(64)), false);
});

test('authoritative snapshots reject invalid UTF-8', () => {
  assert.equal(decodeContent({ encoding: 'base64', content: 'aGVsbG8=' }), 'hello');
  assert.equal(decodeContent({ encoding: 'base64', content: 'wyg=' }), null);
});
