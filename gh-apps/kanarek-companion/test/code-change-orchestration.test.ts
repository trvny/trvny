import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCodeChangeAutopilotOpenApi,
  commitProvenanceMatches,
  decodeContent,
  expandRefactorAllowedPaths,
  operationCommitMessage,
  recoveredChangedPathsAllowed,
  refactorAllowedPaths,
  refactorEditBlockers,
  refactorPreflightBlockers,
  refactorVerificationBlockers,
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
  const refactor = operation.requestBody.content['application/json'].schema.properties.refactor;
  assert.deepEqual(refactor.required, ['moves', 'referenceTerms']);
  assert.deepEqual(refactor.properties.moves.items.required, ['fromPath', 'toPath']);
  assert.equal(refactor.properties.moves.maxItems, 3);
});

test('refactor edits require an atomic source delete and destination write', () => {
  const plan = {
    moves: [{ fromPath: 'src/old.ts', toPath: 'src/new.ts' }],
    referenceTerms: ['OldThing'],
  };
  assert.deepEqual(refactorEditBlockers(plan, [
    { path: 'src/old.ts', content: null },
    { path: 'src/new.ts', content: 'export const NewThing = 1;' },
  ], true), []);
  assert.deepEqual(refactorEditBlockers(plan, [
    { path: 'src/new.ts', content: 'export const NewThing = 1;' },
  ], true), ['source_delete_required:src/old.ts']);
  assert.deepEqual(refactorEditBlockers(plan, [
    { path: 'src/old.ts', content: 'recreated' },
  ], false), ['source_recreated:src/old.ts']);
});

test('refactor scope expands only to exact-base reference matches', () => {
  const core = {
    operationId: 'op-example123', repository: 'trvny/trvny', goal: 'rename', branch: 'feat/rename',
    expectedBaseSha: 'a'.repeat(40), targetPaths: ['src/old.ts', 'src/new.ts'], investigationTerms: ['OldThing'],
  };
  const snapshot = {
    ref: 'a'.repeat(40), moveFiles: [],
    references: [{ term: 'OldThing', indexedCount: 2, incomplete: false, matchingPaths: ['src/caller.ts', 'src/old.ts'] }],
  };
  assert.deepEqual(refactorAllowedPaths(core, snapshot), ['src/old.ts', 'src/new.ts', 'src/caller.ts']);
  assert.deepEqual(
    expandRefactorAllowedPaths(['src/old.ts', 'src/new.ts', 'src/first-caller.ts'], snapshot),
    ['src/old.ts', 'src/new.ts', 'src/first-caller.ts', 'src/caller.ts'],
  );
});

test('refactor snapshots fail closed on stale or incomplete references', () => {
  const plan = {
    moves: [{ fromPath: 'src/old.ts', toPath: 'src/new.ts' }],
    referenceTerms: ['OldThing'],
  };
  assert.deepEqual(refactorPreflightBlockers(plan, [
    { path: 'src/old.ts', exists: true },
    { path: 'src/new.ts', exists: false },
  ]), []);
  assert.deepEqual(refactorVerificationBlockers(plan, [
    { path: 'src/old.ts', exists: false },
    { path: 'src/new.ts', exists: true },
  ], [{ term: 'OldThing', indexedCount: 2, incomplete: false, matchingPaths: [] }]), []);
  assert.deepEqual(refactorVerificationBlockers(plan, [
    { path: 'src/old.ts', exists: false },
    { path: 'src/new.ts', exists: true },
  ], [{ term: 'OldThing', indexedCount: 41, incomplete: true, matchingPaths: ['src/caller.ts'] }]), [
    'reference_scan_incomplete:OldThing',
    'stale_reference:OldThing:src/caller.ts',
  ]);
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
