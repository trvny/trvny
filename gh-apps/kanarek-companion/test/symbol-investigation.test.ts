import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addSymbolInvestigationOpenApi,
  classifySymbolLine,
  handleSymbolInvestigationAction,
  likelyTestPath,
  symbolAllowed,
  symbolOccurrences,
} from '../src/symbol-investigation.ts';

type JsonObject = Record<string, unknown>;

function base64(value: string): string {
  return btoa(value);
}

test('symbol validation and classification stay conservative', () => {
  assert.equal(symbolAllowed('FeedRepository'), true);
  assert.equal(symbolAllowed('foo-bar'), false);

  assert.deepEqual(classifySymbolLine('export class FeedRepository {', 'FeedRepository'), {
    kind: 'definition',
    confidence: 'high',
  });
  assert.deepEqual(classifySymbolLine("import { FeedRepository } from './feed';", 'FeedRepository'), {
    kind: 'import',
    confidence: 'high',
  });
  assert.deepEqual(classifySymbolLine('class LocalRepo : FeedRepository {', 'FeedRepository'), {
    kind: 'implementation',
    confidence: 'medium',
  });
  assert.deepEqual(classifySymbolLine('const repo = new FeedRepository();', 'FeedRepository'), {
    kind: 'reference',
    confidence: 'medium',
  });
});

test('test paths and occurrences are surfaced with context', () => {
  assert.equal(likelyTestPath('src/foo.ts'), false);
  assert.equal(likelyTestPath('test/foo.test.ts'), true);
  assert.equal(likelyTestPath('app/src/androidTest/FooTest.kt'), true);

  const occurrences = symbolOccurrences(
    [
      "import { WorkerState } from './state';",
      '',
      'export interface WorkerState {',
      '  ok: boolean;',
      '}',
      '',
      'const value: WorkerState = { ok: true };',
    ].join('\n'),
    'WorkerState',
  );
  assert.equal(occurrences.length, 3);
  assert.equal(occurrences[0].kind, 'import');
  assert.equal(occurrences[1].kind, 'definition');
  assert.equal(occurrences[2].kind, 'reference');
  assert.match(occurrences[1].context, /3: export interface WorkerState/);
});

test('symbol action is exposed in OpenAPI', () => {
  const document: JsonObject = { paths: {} };
  addSymbolInvestigationOpenApi(document);
  const paths = document.paths as Record<string, { post?: { operationId?: string } }>;
  assert.equal(paths['/gpt-actions/github/code/symbol']?.post?.operationId, 'investigateSymbol');
});

test('symbol investigation pins content and separates matching tests', async () => {
  const sha = 'a'.repeat(40);
  const source = new Request('https://example.workers.dev/gpt-actions/github/code/symbol', {
    method: 'POST',
    headers: {
      authorization: 'Bearer token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      repository: 'trvny/trvny',
      symbol: 'WorkerState',
      maxFiles: 4,
      ref: 'main',
    }),
  });

  const invoke = async (request: Request): Promise<Response> => {
    const body = (await request.json()) as { path?: string };
    const path = body.path ?? '';
    let data: unknown;

    if (path === '/repos/trvny/trvny') {
      data = { default_branch: 'main' };
    } else if (path === '/repos/trvny/trvny/commits/main') {
      data = { sha };
    } else if (path.startsWith('/search/code?')) {
      data = {
        total_count: 2,
        incomplete_results: false,
        items: [
          {
            path: 'src/state.ts',
            sha: 'search-a',
            html_url: 'https://github.com/trvny/trvny/blob/main/src/state.ts',
          },
          {
            path: 'test/state.test.ts',
            sha: 'search-b',
            html_url: 'https://github.com/trvny/trvny/blob/main/test/state.test.ts',
          },
        ],
      };
    } else if (path === `/repos/trvny/trvny/contents/src/state.ts?ref=${sha}`) {
      const content = [
        'export interface WorkerState {',
        '  ok: boolean;',
        '}',
        'export const current: WorkerState = { ok: true };',
      ].join('\n');
      data = {
        encoding: 'base64',
        content: base64(content),
        size: content.length,
        sha: 'content-a',
      };
    } else if (path === `/repos/trvny/trvny/contents/test/state.test.ts?ref=${sha}`) {
      const content = [
        "import type { WorkerState } from '../src/state';",
        'const fixture: WorkerState = { ok: true };',
      ].join('\n');
      data = {
        encoding: 'base64',
        content: base64(content),
        size: content.length,
        sha: 'content-b',
      };
    } else {
      return Response.json({ ok: false, error: `unexpected_${path}` }, { status: 404 });
    }
    return Response.json({ ok: true, data });
  };

  const response = await handleSymbolInvestigationAction(source, invoke);
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as {
    repository: { resolvedRefSha: string };
    summary: { definitions: number; testOccurrences: number };
    definitions: Array<{ path: string }>;
    tests: Array<{ path: string }>;
  };
  assert.equal(payload.repository.resolvedRefSha, sha);
  assert.equal(payload.summary.definitions, 1);
  assert.equal(payload.summary.testOccurrences, 2);
  assert.equal(payload.definitions[0]?.path, 'src/state.ts');
  assert.equal(payload.tests.every((entry) => entry.path === 'test/state.test.ts'), true);
});
