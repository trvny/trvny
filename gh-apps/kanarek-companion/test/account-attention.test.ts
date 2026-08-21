import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_ATTENTION_PATH,
  addAccountAttentionOpenApi,
  handleAccountAttentionAction,
} from '../src/account-attention.ts';

function request(body: unknown = {}): Request {
  return new Request(`https://worker.test${ACCOUNT_ATTENTION_PATH}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

test('builds a policy-scoped attention queue from maintenance, PR inspection and issues', async () => {
  const invoked: string[] = [];
  const invoke = async (internal: Request): Promise<Response> => {
    const url = new URL(internal.url);
    invoked.push(url.pathname);
    if (url.pathname === '/gpt-actions/github/maintenance/account') {
      return Response.json({
        ok: true,
        repositories: [
          {
            name: 'trvny/example',
            attention: ['workflow_problems'],
            pullRequests: {
              items: [
                {
                  number: 7,
                  title: 'Ready PR',
                  draft: false,
                  updatedAt: '2026-08-21T06:00:00Z',
                  htmlUrl: 'https://github.com/trvny/example/pull/7',
                },
              ],
            },
          },
        ],
        policyApplied: { source: 'private' },
        policyExcluded: ['trvny/excluded'],
      });
    }
    if (url.pathname === '/gpt-actions/github/pull-requests/inspect') {
      return Response.json({
        ok: true,
        data: {
          finalizeSnapshot: {
            state: 'open',
            draft: false,
            headSha: 'a'.repeat(40),
            mergeable: true,
            ciState: 'success',
            unresolvedThreads: 0,
            activeChangeRequests: 0,
          },
        },
      });
    }
    if (url.pathname === '/gpt-actions/github/read') {
      const body = await internal.json() as { path: string };
      assert.match(body.path, /\/repos\/trvny\/example\/issues\?/);
      return Response.json({
        ok: true,
        data: [
          {
            number: 3,
            title: 'Open issue',
            user: { login: 'someone' },
            assignees: [],
            labels: [{ name: 'bug' }],
            comments: 2,
            updated_at: new Date().toISOString(),
            html_url: 'https://github.com/trvny/example/issues/3',
          },
          {
            number: 7,
            title: 'PR masquerading as issue',
            pull_request: { url: 'https://api.github.com/repos/trvny/example/pulls/7' },
          },
        ],
      });
    }
    return Response.json({ ok: false, error: 'unexpected_route' }, { status: 500 });
  };

  const response = await handleAccountAttentionAction(request(), invoke);
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    queue: Array<{ type: string; reasons: string[] }>;
    issues: Array<{ number: number; reasons: string[] }>;
    pullRequests: Array<{ number: number; reasons: string[] }>;
    policyExcluded: string[];
  };
  assert.equal(payload.pullRequests[0]?.number, 7);
  assert.ok(payload.pullRequests[0]?.reasons.includes('merge_candidate'));
  assert.equal(payload.issues.length, 1);
  assert.equal(payload.issues[0]?.number, 3);
  assert.ok(payload.issues[0]?.reasons.includes('unassigned_issue'));
  assert.ok(payload.queue.some((item) => item.type === 'repository_maintenance'));
  assert.deepEqual(payload.policyExcluded, ['trvny/excluded']);
  assert.ok(invoked.includes('/gpt-actions/github/maintenance/account'));
  assert.ok(invoked.includes('/gpt-actions/github/pull-requests/inspect'));
  assert.ok(invoked.includes('/gpt-actions/github/read'));
});

test('rejects unbounded attention sweep limits', async () => {
  const response = await handleAccountAttentionAction(
    request({ maxRepositories: 999 }),
    async () => Response.json({ ok: true }),
  );
  assert.ok(response);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'invalid_attention_limits' });
});

test('registers the account attention action in OpenAPI', () => {
  const document: Record<string, unknown> = { paths: {} };
  addAccountAttentionOpenApi(document);
  const paths = document.paths as Record<string, { post?: { operationId?: string } }>;
  assert.equal(paths[ACCOUNT_ATTENTION_PATH]?.post?.operationId, 'getAccountAttention');
});
