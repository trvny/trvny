import assert from 'node:assert/strict';
import test from 'node:test';

import { CODE_HISTORY_PATH, handleCodeHistoryAction } from '../src/code-history.ts';

test('focused history exposes failed PR enrichment instead of an empty verified result', async () => {
  const sha = 'b'.repeat(40);
  const source = new Request('https://example.workers.dev' + CODE_HISTORY_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify({
      repository: 'trvny/trvny',
      path: 'src/sample.ts',
      ref: 'main',
      maxCommits: 1,
    }),
  });

  const invoke = async (request: Request): Promise<Response> => {
    const body = (await request.json()) as Record<string, unknown>;
    const pathname = new URL(request.url).pathname;
    if (pathname === '/gpt-actions/github/graphql') {
      return Response.json({
        ok: true,
        data: {
          data: {
            repository: { object: { blame: { ranges: [] } } },
          },
        },
      });
    }

    assert.equal(pathname, '/gpt-actions/github/read');
    const path = String(body.path);
    if (path === '/repos/trvny/trvny/commits/main') {
      return Response.json({ ok: true, data: { sha } });
    }
    if (path === `/repos/trvny/trvny/commits?sha=${sha}&path=src%2Fsample.ts&per_page=1`) {
      return Response.json({
        ok: true,
        data: [
          {
            sha,
            html_url: `https://github.com/trvny/trvny/commit/${sha}`,
            author: { login: 'gptomek[bot]' },
            commit: {
              message: 'sample change',
              author: { name: 'GPTomek', email: null, date: '2026-08-22T00:00:00Z' },
            },
          },
        ],
      });
    }
    if (path === `/repos/trvny/trvny/commits/${sha}/pulls?per_page=5`) {
      return Response.json({ ok: false, error: 'github_down' }, { status: 503 });
    }
    return Response.json({ ok: false, error: `unexpected_read:${path}` }, { status: 500 });
  };

  const response = await handleCodeHistoryAction(source, invoke);
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = (await response.json()) as Record<string, any>;
  assert.deepEqual(payload.recentCommits[0].pullRequests, []);
  assert.equal(payload.recentCommits[0].pullRequestsQueried, false);
  assert.deepEqual(payload.enrichment.attemptedCommitShas, [sha]);
  assert.deepEqual(payload.enrichment.queriedCommitShas, []);
  assert.deepEqual(payload.enrichment.failedCommitShas, [sha]);
});
