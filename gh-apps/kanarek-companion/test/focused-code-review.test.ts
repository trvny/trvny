import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addFocusedCodeReviewOpenApi,
  focusedReviewScopeBlockers,
  FOCUSED_CODE_REVIEW_PATH,
  handleFocusedCodeReviewAction,
  reviewLensSummary,
} from '../src/focused-code-review.ts';

test('focused review is exposed as reviewCodeChange', () => {
  const document: Record<string, any> = { paths: {} };
  addFocusedCodeReviewOpenApi(document);
  const operation = document.paths[FOCUSED_CODE_REVIEW_PATH].post;
  assert.equal(operation.operationId, 'reviewCodeChange');
  assert.deepEqual(operation.requestBody.content['application/json'].schema.required, [
    'repository', 'baseSha', 'headSha',
  ]);
  assert.equal(
    operation.requestBody.content['application/json'].schema.properties.targetPaths.maxItems,
    12,
  );
});

test('review lenses surface scope drift, unmodified callers and missing focused tests', () => {
  const files = [
    {
      path: 'src/api.ts', previousPath: null, status: 'modified', additions: 2, deletions: 1, changes: 3,
      patch: '+export interface Result { state: string | null }\n-if (old) return old\n+if (next === null) throw new Error()',
      patchTruncated: false, testFile: false, docsFile: false,
    },
    {
      path: 'src/surprise.ts', previousPath: null, status: 'modified', additions: 1, deletions: 0, changes: 1,
      patch: '+export const extra = true', patchTruncated: false, testFile: false, docsFile: false,
    },
  ];
  const dependencies = [
    {
      path: 'src/api.ts', basePath: 'src/api.ts', headPath: 'src/api.ts', before: {}, after: {},
      callersBefore: ['src/caller.ts'], callersAfter: ['src/caller.ts'], addedCallers: [], removedCallers: [],
      unmodifiedCallers: ['src/caller.ts'], incomplete: false,
    },
  ];
  const result = reviewLensSummary(files, dependencies, ['src/api.ts']) as Record<string, any>;
  assert.deepEqual(result.scope.unexpectedChangedPaths, ['src/surprise.ts']);
  assert.deepEqual(result.tests.productionWithoutChangedTests, ['src/api.ts', 'src/surprise.ts']);
  assert.deepEqual(result.missedCallers.candidates, ['src/caller.ts']);
  assert.ok(result.apiContract.signals.some((entry: Record<string, string>) => entry.path === 'src/api.ts'));
  assert.ok(result.stateAndRace.signals.some((entry: Record<string, string>) => entry.line.includes('state')));
  assert.ok(result.edgeCases.signals.some((entry: Record<string, string>) => entry.line.includes('throw')));
});

test('scope blockers are deterministic and path-specific', () => {
  assert.deepEqual(
    focusedReviewScopeBlockers({
      scope: { unexpectedChangedPaths: ['src/a.ts', 'src/b.ts'] },
    }),
    ['unexpected_changed_path:src/a.ts', 'unexpected_changed_path:src/b.ts'],
  );
  assert.deepEqual(focusedReviewScopeBlockers({}), ['invalid_focused_review_scope']);
});

test('focused review pins exact snapshots and returns bounded diff evidence', async () => {
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);
  const request = new Request(`https://example.workers.dev${FOCUSED_CODE_REVIEW_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repository: 'trvny/trvny', baseSha, headSha, targetPaths: ['README.md'] }),
  });
  const invoke = async (internal: Request): Promise<Response> => {
    const body = await internal.json() as { path: string };
    if (body.path.endsWith(`/commits/${baseSha}`)) {
      return Response.json({ ok: true, data: { sha: baseSha } });
    }
    if (body.path.endsWith(`/commits/${headSha}`)) {
      return Response.json({ ok: true, data: { sha: headSha } });
    }
    if (body.path.includes('/compare/')) {
      return Response.json({
        ok: true,
        data: {
          status: 'ahead',
          files: [{
            filename: 'README.md', status: 'modified', additions: 1, deletions: 1, changes: 2,
            patch: '@@ -1 +1 @@\n-old\n+new',
          }],
        },
      });
    }
    return Response.json({ ok: false, error: 'unexpected_read' }, { status: 500 });
  };
  const response = await handleFocusedCodeReviewAction(request, invoke);
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await response.json() as Record<string, any>;
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.snapshots, { baseSha, headSha });
  assert.equal(payload.summary.changedFiles, 1);
  assert.deepEqual(payload.scope.unexpectedChangedPaths, []);
  assert.equal(payload.nextAction.reviewedHeadSha, headSha);
});
