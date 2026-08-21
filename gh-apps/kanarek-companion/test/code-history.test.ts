import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addCodeHistoryOpenApi,
  CODE_HISTORY_PATH,
  handleCodeHistoryAction,
  selectBlameRanges,
  symbolLineNumbers,
} from '../src/code-history.ts';

test('symbolLineNumbers matches identifier boundaries', () => {
  const content = [
    'const Widget = 1;',
    'use(Widget);',
    'const WidgetFactory = 2;',
    '// Widget',
  ].join('\n');
  assert.deepEqual(symbolLineNumbers(content, 'Widget'), [1, 2, 4]);
});

test('selectBlameRanges focuses on line ranges and symbol lines', () => {
  const ranges = [
    { startingLine: 1, endingLine: 4, id: 'a' },
    { startingLine: 5, endingLine: 8, id: 'b' },
    { startingLine: 9, endingLine: 12, id: 'c' },
  ];
  assert.deepEqual(
    selectBlameRanges(ranges, 6, 6, [10]).map((range) => range.id),
    ['b', 'c'],
  );
});

test('focused history resolves an exact snapshot and joins blame with PR context', async () => {
  const sha = 'a'.repeat(40);
  const content = 'export function Widget() {}\nWidget();\n';
  const source = new Request('https://example.workers.dev' + CODE_HISTORY_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify({
      repository: 'trvny/trvny',
      path: 'src/sample.ts',
      ref: 'main',
      symbol: 'Widget',
      maxCommits: 2,
    }),
  });

  const invoke = async (request: Request): Promise<Response> => {
    const body = (await request.json()) as Record<string, unknown>;
    const pathname = new URL(request.url).pathname;
    if (pathname === '/gpt-actions/github/graphql') {
      assert.equal(typeof body.query, 'string');
      assert.deepEqual(body.variables, {
        owner: 'trvny',
        name: 'trvny',
        expression: sha,
        path: 'src/sample.ts',
      });
      return Response.json({
        ok: true,
        data: {
          data: {
            repository: {
              object: {
                blame: {
                  ranges: [
                    {
                      startingLine: 1,
                      endingLine: 2,
                      age: 1,
                      commit: {
                        oid: sha,
                        abbreviatedOid: sha.slice(0, 12),
                        messageHeadline: 'add Widget',
                        committedDate: '2026-08-21T00:00:00Z',
                        url: `https://github.com/trvny/trvny/commit/${sha}`,
                        author: { name: 'GPTomek', email: null, user: { login: 'gptomek[bot]' } },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      });
    }

    assert.equal(pathname, '/gpt-actions/github/read');
    const path = String(body.path);
    if (path === '/repos/trvny/trvny/commits/main') {
      return Response.json({ ok: true, data: { sha } });
    }
    if (path === `/repos/trvny/trvny/contents/src/sample.ts?ref=${sha}`) {
      return Response.json({
        ok: true,
        data: {
          encoding: 'base64',
          size: content.length,
          content: Buffer.from(content).toString('base64'),
        },
      });
    }
    if (path === `/repos/trvny/trvny/commits?sha=${sha}&path=src%2Fsample.ts&per_page=2`) {
      return Response.json({
        ok: true,
        data: [
          {
            sha,
            html_url: `https://github.com/trvny/trvny/commit/${sha}`,
            author: { login: 'gptomek[bot]' },
            commit: {
              message: 'add Widget',
              author: { name: 'GPTomek', email: null, date: '2026-08-21T00:00:00Z' },
            },
          },
        ],
      });
    }
    if (path === `/repos/trvny/trvny/commits/${sha}/pulls?per_page=5`) {
      return Response.json({
        ok: true,
        data: [
          {
            number: 123,
            title: 'Add Widget',
            state: 'closed',
            merged_at: '2026-08-21T00:01:00Z',
            html_url: 'https://github.com/trvny/trvny/pull/123',
            base: { ref: 'main' },
            head: { ref: 'feat/widget' },
          },
        ],
      });
    }
    return Response.json({ ok: false, error: `unexpected_read:${path}` }, { status: 500 });
  };

  const response = await handleCodeHistoryAction(source, invoke);
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as Record<string, any>;
  assert.equal(payload.snapshot.sha, sha);
  assert.deepEqual(payload.focus.symbolMatches.lines, [1, 2]);
  assert.equal(payload.blame.ranges.length, 1);
  assert.equal(payload.blame.ranges[0].commit.pullRequests[0].number, 123);
  assert.equal(payload.recentCommits[0].pullRequests[0].number, 123);
});

test('focused history is exposed in OpenAPI', () => {
  const document: Record<string, any> = { paths: {} };
  addCodeHistoryOpenApi(document);
  assert.equal(document.paths[CODE_HISTORY_PATH].post.operationId, 'investigateCodeHistory');
  assert.ok(document.paths[CODE_HISTORY_PATH].post.description.length <= 300);
});
