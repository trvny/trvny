import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addBugInvestigationOpenApi,
  BUG_INVESTIGATION_PATH,
  bugFilterAllowed,
  bugHandoffFingerprint,
  bugHandoffTerms,
  bugInvestigationFingerprint,
  buildBugGoal,
  existingTargetPaths,
  extractBugPaths,
  extractBugSymbols,
  workflowEvidenceText,
} from '../src/bug-investigation.ts';

test('bug symbols prioritize explicit hints and stack frames', () => {
  const text = `TypeError: boom\n    at WorkerRouter.handleRequest (src/router.ts:42:3)\n    at runCodeChange (src/code-change.ts:8:1)`;
  assert.deepEqual(
    extractBugSymbols(text, ['KnownFailure'], 5),
    ['KnownFailure', 'handleRequest', 'WorkerRouter', 'runCodeChange'],
  );
});

test('bug symbols deduplicate case-insensitively', () => {
  assert.deepEqual(extractBugSymbols('at Foo.foo (src/foo.ts:1:1)'), ['foo']);
  assert.deepEqual(extractBugSymbols('boom', ['KnownFailure', 'knownfailure']), ['KnownFailure']);
});

test('bug symbols match the downstream term contract', () => {
  assert.deepEqual(extractBugSymbols('boom', ['$invalid', 'Valid_Name']), ['Valid_Name']);
  assert.deepEqual(extractBugSymbols('boom', ['x'.repeat(81)]), []);
});

test('bug symbols recognize async stack frames', () => {
  assert.deepEqual(extractBugSymbols('at async parse (src/parser.ts:4:2)'), ['parse']);
});

test('bug symbols recognize Python traceback frames', () => {
  const text = 'Traceback (most recent call last):\n  File "/home/runner/work/repo/parser.py", line 42, in parse_config\nValueError: boom';
  assert.deepEqual(extractBugSymbols(text, [], 1), ['parse_config']);
});

test('bug symbols prioritize terminal members of qualified stack frames', () => {
  const text = 'at org.springframework.context.support.AbstractApplicationContext.refresh(ApplicationContext.java:4)';
  assert.deepEqual(extractBugSymbols(text, [], 4), ['refresh', 'AbstractApplicationContext']);
});

test('TypeScript module extensions are not treated as symbols', () => {
  const text = 'at parseConfig (src/config.mts:1:1)\nsrc/other.cts';
  assert.deepEqual(extractBugSymbols(text), ['parseConfig']);
});

test('bug paths extract repository-relative and root files once', () => {
  const text = [
    'at handleRequest (src/router.ts:42:3)',
    'index.ts:4:2: error TS1000',
    'at handleRequest (src/router.ts:43:3)',
    'File "gh-apps/kanarek-companion/src/operator-actions.ts", line 12',
    'at outside (/home/runner/work/repo/repo/src/outside.ts:1:1)',
    'https://example.com/docs/sample.ts',
  ].join('\n');
  assert.deepEqual(extractBugPaths(text), [
    'src/router.ts',
    'index.ts',
    'gh-apps/kanarek-companion/src/operator-actions.ts',
  ]);
});

test('bug paths skip dependency frames before applying their result limit', () => {
  const dependencies = Array.from({ length: 6 }, (_, index) => `at dep${index} (node_modules/pkg${index}/index.js:1:1)`);
  const text = [...dependencies, 'at app (src/app.ts:2:1)'].join('\n');
  assert.deepEqual(extractBugPaths(text), ['src/app.ts']);
});

test('bug paths respect targeted-test path depth', () => {
  const deepPath = `${'segment/'.repeat(32)}index.ts`;
  assert.deepEqual(extractBugPaths(`${deepPath}:4:2`), []);
});

test('exact path hints are accepted only when they resolve to a pinned blob', async () => {
  const rootSha = '1'.repeat(40);
  const srcSha = '2'.repeat(40);
  const fileSha = '3'.repeat(40);
  const request = new Request('https://worker.test/gpt-actions/operator/bug-investigate', { method: 'POST' });
  const invoke = async (child: Request): Promise<Response> => {
    const body = await child.json() as { path: string };
    if (body.path.includes('/commits/')) {
      return Response.json({ ok: true, data: { commit: { tree: { sha: rootSha } } } });
    }
    if (body.path.endsWith(`/git/trees/${rootSha}`)) {
      return Response.json({ ok: true, data: { tree: [{ path: 'src', mode: '040000', type: 'tree', sha: srcSha }] } });
    }
    if (body.path.endsWith(`/git/trees/${srcSha}`)) {
      return Response.json({ ok: true, data: { tree: [{ path: 'app.ts', mode: '100644', type: 'blob', sha: fileSha }] } });
    }
    throw new Error(`unexpected read: ${body.path}`);
  };
  assert.deepEqual(
    await existingTargetPaths(
      request,
      invoke,
      'trvny/trvny',
      'a'.repeat(40),
      ['src/app.ts', 'src/missing.ts', 'src'],
    ),
    ['src/app.ts'],
  );
});

test('bug handoff terms fall back to exact target paths', () => {
  assert.deepEqual(bugHandoffTerms([], ['index.ts']), ['index.ts']);
  assert.deepEqual(bugHandoffTerms(['parseConfig'], ['index.ts']), ['parseConfig']);
  assert.deepEqual(bugHandoffTerms([], ['x'.repeat(81)]), []);
});

test('bug handoff identity is collision-resistant and snapshot-bound', async () => {
  const base = {
    repository: 'trvny/trvny',
    goal: 'Fix it',
    evidenceSha: 'a'.repeat(40),
    expectedBaseSha: 'b'.repeat(40),
    targetPaths: ['index.ts'],
    investigationTerms: ['index.ts'],
  };
  const fingerprint = await bugHandoffFingerprint(base);
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint, await bugHandoffFingerprint({ ...base }));
  assert.notEqual(
    fingerprint,
    await bugHandoffFingerprint({ ...base, evidenceSha: 'c'.repeat(40) }),
  );
  assert.notEqual(
    fingerprint,
    await bugHandoffFingerprint({ ...base, targetPaths: ['src/index.ts'] }),
  );
});

test('workflow evidence prioritizes failure excerpts over diagnosis metadata', () => {
  const text = workflowEvidenceText({
    failingJobs: [{ name: 'check', failedSteps: [{ name: 'Run tests' }], htmlUrl: 'https://example.test' }],
    logExcerpts: [{ excerpt: 'TypeError: nope\n    at parseConfig (src/config.ts:2:1)' }],
  });
  assert.deepEqual(extractBugSymbols(text, [], 4), ['parseConfig']);
  assert.ok(!text.includes('failingJobs'));
  assert.ok(!text.includes('logExcerpts'));
  assert.ok(!text.includes('htmlUrl'));
});

test('bug handoff filters match downstream path and language contracts', () => {
  assert.equal(bugFilterAllowed('src/worker.ts', 'path'), true);
  assert.equal(bugFilterAllowed('src files', 'path'), false);
  assert.equal(bugFilterAllowed('../src', 'path'), false);
  assert.equal(bugFilterAllowed('TypeScript', 'language'), true);
  assert.equal(bugFilterAllowed('Type Script', 'language'), false);
  assert.equal(bugFilterAllowed('x'.repeat(41), 'language'), false);
});

test('bug handoff goal stays within the code-change limit', () => {
  const goal = buildBugGoal('long source', 'x'.repeat(10_000));
  assert.ok(goal.length <= 4_000);
  assert.match(goal, /^Investigate and fix this bug/);
});

test('bug investigation fingerprint is deterministic and compact', () => {
  assert.equal(bugInvestigationFingerprint('same input'), bugInvestigationFingerprint('same input'));
  assert.match(bugInvestigationFingerprint('same input'), /^[0-9a-f]{8}$/);
  assert.notEqual(bugInvestigationFingerprint('same input'), bugInvestigationFingerprint('other input'));
});

test('bug investigation OpenAPI requires exactly one bug source alternative', () => {
  const document: Record<string, any> = { paths: {} };
  addBugInvestigationOpenApi(document);
  const schema = document.paths[BUG_INVESTIGATION_PATH].post.requestBody.content['application/json'].schema;
  assert.deepEqual(schema.oneOf, [
    { required: ['issueNumber'] },
    { required: ['workflowRunId'] },
    { required: ['errorText'] },
  ]);
});

test('bug investigation is exposed as a high-level OpenAPI action', () => {
  const document: Record<string, any> = { paths: {} };
  addBugInvestigationOpenApi(document);
  const operation = document.paths[BUG_INVESTIGATION_PATH].post;
  assert.equal(operation.operationId, 'investigateBug');
  assert.deepEqual(operation.requestBody.content['application/json'].schema.required, ['repository']);
  assert.ok(operation.requestBody.content['application/json'].schema.properties.issueNumber);
  assert.ok(operation.requestBody.content['application/json'].schema.properties.workflowRunId);
  assert.ok(operation.requestBody.content['application/json'].schema.properties.errorText);
  assert.equal(operation.requestBody.content['application/json'].schema.properties.language.maxLength, 40);
  assert.equal(operation.requestBody.content['application/json'].schema.properties.hints.items.maxLength, 80);
});