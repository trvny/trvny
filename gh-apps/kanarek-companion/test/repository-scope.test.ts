import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  githubBotRequestAllowed,
  githubReadAllowed,
  handleGptActions,
  type GptActionsEnv,
} from '../src/gpt-actions.ts';
import { gptomekInstallationIdFor } from '../src/github-app.ts';
import { repositoryAllowedByPolicy } from '../src/policy-enforcement.ts';
import { repositoryInScope, repositoryPathInScope } from '../src/tools/common.ts';

test('repository scope accepts exactly trvny/* and travnie/*', () => {
  for (const ok of ['trvny/feedseek', 'travnie/kanarek', 'travnie/a.b_c-d']) {
    assert.equal(repositoryInScope(ok), true, ok);
  }
  for (const bad of [
    'trvny-x/feedseek',
    'travniex/kanarek',
    'xtrvny/feedseek',
    'openai/openai',
    'trvny/a/b',
    'trvny/',
    '/trvny/a',
    'trvny/a b',
    'trvny/..%2f',
    'TRVNY/feedseek',
  ]) {
    assert.equal(repositoryInScope(bad), false, bad);
  }
});

test('repository path scope matches whole owner and name segments', () => {
  assert.equal(repositoryPathInScope('/repos/travnie/kanarek'), true);
  assert.equal(repositoryPathInScope('/repos/travnie/kanarek/pulls'), true);
  assert.equal(repositoryPathInScope('/repos/travniex/kanarek/pulls'), false);
  assert.equal(repositoryPathInScope('/repos/trvny-x/feedseek'), false);
  assert.equal(repositoryPathInScope('/repos/trvny'), false);
});

test('read gateway covers travnie and rejects out-of-scope search qualifiers', () => {
  assert.equal(githubReadAllowed('/repos/travnie/kanarek/pulls?state=open'), true);
  assert.equal(githubReadAllowed('/repos/travniex/kanarek/pulls'), false);
  assert.equal(githubReadAllowed('/search/code?q=foo+user%3Atrvny+org%3Atravnie'), true);
  assert.equal(githubReadAllowed('/search/issues?q=is%3Apr+repo%3Atravnie%2Fkanarek'), true);
  assert.equal(githubReadAllowed('/search/issues?q=user%3Atrvnyx'), false);
  assert.equal(
    githubReadAllowed('/search/code?q=secret+repo%3Atrvny%2Ffeedseek+repo%3Aevil%2Fx'),
    false,
  );
});

test('bot gateway covers travnie with the same write policy', () => {
  assert.equal(
    githubBotRequestAllowed('POST', '/repos/travnie/kanarek/issues/1/comments', { body: 'ok' }),
    true,
  );
  assert.equal(githubBotRequestAllowed('GET', '/repos/travnie/kanarek/pulls'), true);
  assert.equal(
    githubBotRequestAllowed('POST', '/repos/travnie/kanarek/pulls', { title: 'nope' }),
    false,
  );
  assert.equal(
    githubBotRequestAllowed('POST', '/repos/travniex/kanarek/issues/1/comments', { body: 'x' }),
    false,
  );
});

test('policy wildcards match only their own owner', () => {
  const policy = {
    runtime: { repositories: { include: ['trvny/*', 'travnie/*'], exclude: ['travnie/private'] } },
  } as unknown as Parameters<typeof repositoryAllowedByPolicy>[0];
  assert.equal(repositoryAllowedByPolicy(policy, 'travnie/kanarek'), true);
  assert.equal(repositoryAllowedByPolicy(policy, 'trvny/feedseek'), true);
  assert.equal(repositoryAllowedByPolicy(policy, 'travnie/private'), false);
  assert.equal(repositoryAllowedByPolicy(policy, 'travniex/kanarek'), false);
});

test('bot writes on travnie use that repository installation', async () => {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const calls: Array<{ method: string; path: string; auth: string }> = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    calls.push({ method, path: url.pathname, auth });
    if (url.pathname === '/user') return Response.json({ login: 'trvny', id: 1 });
    if (url.pathname === '/repos/travnie/kanarek/installation') return Response.json({ id: 77 });
    if (method === 'POST' && url.pathname === '/app/installations/77/access_tokens') {
      return Response.json({ token: 'travnie-token', expires_at: '2099-01-01T00:00:00Z' });
    }
    if (method === 'POST' && url.pathname === '/repos/travnie/kanarek/issues/1/comments') {
      return Response.json({ id: 5 }, { status: 201 });
    }
    return Response.json({ message: 'unexpected' }, { status: 500 });
  }) as typeof fetch;

  const response = await handleGptActions(
    new Request('https://worker.test/gpt-actions/github/bot', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        method: 'POST',
        path: '/repos/travnie/kanarek/issues/1/comments',
        body: { body: 'hello' },
      }),
    }),
    {
      GPTOMEK_APP_ID: '123',
      GPTOMEK_PRIVATE_KEY: privateKey,
      GPTOMEK_INSTALLATION_ID: '1',
    } as unknown as GptActionsEnv,
    fetcher,
  );

  assert.equal(response.status, 200);
  assert.equal(calls.some((call) => call.path === '/app/installations/1/access_tokens'), false);
  const write = calls.find((call) => call.path === '/repos/travnie/kanarek/issues/1/comments');
  assert.match(write?.auth ?? '', /travnie-token/);
});

test('GPTomek installation: configured for trvny, per-repo lookup elsewhere', async () => {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const looked: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    looked.push(url.pathname);
    return Response.json({ id: 77 });
  }) as typeof fetch;

  assert.equal(await gptomekInstallationIdFor('1', '123', privateKey, 'trvny/feedseek', fetcher), 1);
  assert.equal(await gptomekInstallationIdFor('1', '123', privateKey, undefined, fetcher), 1);
  assert.equal(await gptomekInstallationIdFor('nope', '123', privateKey, 'trvny/feedseek', fetcher), null);
  assert.deepEqual(looked, []);
  assert.equal(await gptomekInstallationIdFor('1', '123', privateKey, 'travnie/kanarek', fetcher), 77);
  assert.deepEqual(looked, ['/repos/travnie/kanarek/installation']);
});

test('commit-files accepts travnie and uses that repository installation', async () => {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' })
    .toString();
  const paths: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    paths.push(`${method} ${url.pathname}`);
    if (url.pathname === '/user') return Response.json({ login: 'trvny', id: 1 });
    if (url.pathname === '/repos/travnie/kanarek/installation') return Response.json({ id: 77 });
    if (url.pathname === '/app/installations/77/access_tokens') {
      return Response.json({ token: 'travnie-token', expires_at: '2099-01-01T00:00:00Z' });
    }
    if (url.pathname === '/repos/travnie/kanarek/git/ref/heads/feat/x') {
      return Response.json({ object: { sha: 'b'.repeat(40) } });
    }
    return Response.json({ message: 'unexpected' }, { status: 500 });
  }) as typeof fetch;

  // Past repository validation and auth, the stale head stops the write.
  await assert.rejects(handleGptActions(
    new Request('https://worker.test/gpt-actions/github/commit-files', {
      method: 'POST',
      headers: { authorization: 'Bearer user-token', 'content-type': 'application/json' },
      body: JSON.stringify({
        repository: 'travnie/kanarek',
        branch: 'feat/x',
        expectedHeadSha: 'a'.repeat(40),
        message: 'test',
        files: [{ path: 'README.md', content: 'hi' }],
      }),
    }),
    {
      GPTOMEK_APP_ID: '123',
      GPTOMEK_PRIVATE_KEY: privateKey,
      GPTOMEK_INSTALLATION_ID: '1',
    } as unknown as GptActionsEnv,
    fetcher,
  ), { code: 'branch_head_changed' });

  assert.ok(paths.includes('POST /app/installations/77/access_tokens'));
  assert.ok(!paths.includes('POST /app/installations/1/access_tokens'));
});
