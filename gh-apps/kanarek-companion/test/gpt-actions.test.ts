import assert from 'node:assert/strict';
import test from 'node:test';

import { githubBotRequestAllowed, githubReadAllowed } from '../src/gptomek/github-gateway.ts';
import {
  contentTreeMode,
  handleGptActions,
  openApiDocument,
  type GptActionsEnv,
} from '../src/gptomek/gpt-actions.ts';

test('read gateway stays scoped to trvny', () => {
  assert.equal(githubReadAllowed('/repos/trvny/feedseek/pulls?state=open'), true);
  assert.equal(githubReadAllowed('/search/issues?q=user%3Atrvny+is%3Apr'), true);
  assert.equal(githubReadAllowed('/repos/openai/openai'), false);
  assert.equal(githubReadAllowed('/search/issues?q=is%3Apr'), false);
});

test('bot gateway blocks bot-created PRs and administrative writes', () => {
  assert.equal(
    githubBotRequestAllowed('POST', '/repos/trvny/feedseek/pulls', {
      title: 'nope',
    }),
    false,
  );
  assert.equal(
    githubBotRequestAllowed('POST', '/repos/trvny/feedseek/issues/1/comments', {
      body: 'ok',
    }),
    true,
  );
  assert.equal(
    githubBotRequestAllowed('PATCH', '/repos/trvny/feedseek/hooks/1', {}),
    false,
  );
});

test('git ref writes are limited to branches', () => {
  assert.equal(
    githubBotRequestAllowed('POST', '/repos/trvny/feedseek/git/refs', {
      ref: 'refs/heads/feat/test',
      sha: '0'.repeat(40),
    }),
    true,
  );
  assert.equal(
    githubBotRequestAllowed('POST', '/repos/trvny/feedseek/git/refs', {
      ref: 'refs/tags/nope',
      sha: '0'.repeat(40),
    }),
    false,
  );
  assert.equal(
    githubBotRequestAllowed('DELETE', '/repos/trvny/feedseek/git/refs/tags/nope'),
    false,
  );
});

test('OpenAPI advertises hybrid identities and OAuth token proxy', () => {
  const document = openApiDocument('https://example.workers.dev') as {
    paths: Record<string, { post?: { operationId?: string } }>;
    components: {
      securitySchemes: {
        githubOAuth: {
          flows: { authorizationCode: { tokenUrl: string } };
        };
      };
    };
  };
  const operations = Object.values(document.paths)
    .map((path) => path.post?.operationId)
    .filter(Boolean);
  assert.ok(operations.includes('commitFilesAsGptomek'));
  assert.ok(operations.includes('createPullRequestAsTrvny'));
  assert.equal(
    document.components.securitySchemes.githubOAuth.flows.authorizationCode.tokenUrl,
    'https://example.workers.dev/gpt-actions/oauth/token',
  );
});


test('commit tree mode preserves executable files and symlinks', () => {
  assert.equal(contentTreeMode(undefined), '100644');
  assert.equal(contentTreeMode(undefined, '100755'), '100755');
  assert.equal(contentTreeMode(undefined, '120000'), '120000');
  assert.equal(contentTreeMode({ type: 'blob', mode: '100644' }), '100644');
  assert.equal(contentTreeMode({ type: 'blob', mode: '100755' }, '100755'), '100755');
  assert.equal(contentTreeMode({ type: 'blob', mode: '120000' }), '120000');
  assert.throws(() => contentTreeMode(undefined, '160000'));
  assert.throws(() => contentTreeMode({ type: 'blob', mode: '100644' }, '100755'));
  assert.throws(() => contentTreeMode({ type: 'commit', mode: '160000' }));
});

test('route failures return error envelopes instead of throwing', async () => {
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (url.pathname === '/user') return Response.json({ login: 'trvny', id: 1 });
    return Response.json({ message: 'Not Found' }, { status: 404 });
  }) as typeof fetch;
  const read = (path: string) =>
    handleGptActions(
      new Request('https://worker.test/gpt-actions/github/read', {
        method: 'POST',
        headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
        body: JSON.stringify({ path }),
      }),
      {} as GptActionsEnv,
      fetcher,
    );

  const missing = await read('/repos/trvny/trvny/git/ref/heads/gone');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { ok: false, error: 'github_404_Not Found' });

  const denied = await read('/repos/openai/openai');
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { ok: false, error: 'github_read_path_not_allowed' });
});
