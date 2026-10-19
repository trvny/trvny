import assert from 'node:assert/strict';
import test from 'node:test';

import { GithubActionError, githubGateway } from '../src/github-gateway.ts';
import { handleGptActions, type GptActionsEnv } from '../src/gpt-actions.ts';

// Parity: in-process gateway == POST /gpt-actions/github/* route (code, status, data).

const env = {} as GptActionsEnv;
const ORIGIN = 'https://companion.example';

type Outcome = { status: number; body: Record<string, unknown> };

function githubFetcher(
  routes: Record<string, (init?: RequestInit) => Response>,
  user = 'trvny',
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const key = `${url.pathname}${url.search}`;
    if (key === '/user') return Response.json({ login: user, id: 1 });
    const route = routes[key];
    if (!route) return Response.json({ message: 'Not Found' }, { status: 404 });
    return route(init);
  }) as typeof fetch;
}

function source(token: string | null = 'user-token'): Request {
  return new Request(`${ORIGIN}/gpt-actions/github/code/investigate`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

async function viaRoute(
  route: string,
  body: Record<string, unknown>,
  fetcher: typeof fetch,
  token: string | null = 'user-token',
): Promise<Outcome> {
  const response = await handleGptActions(
    new Request(`${ORIGIN}/gpt-actions/github/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
    env,
    fetcher,
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function viaGateway(work: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { status: 200, body: { ok: true, data: await work() } };
  } catch (error) {
    assert.ok(error instanceof GithubActionError, String(error));
    return { status: error.status, body: error.envelope() };
  }
}

async function assertReadParity(
  path: string,
  fetcher: typeof fetch,
  token: string | null = 'user-token',
): Promise<Outcome> {
  const route = await viaRoute('read', { path }, fetcher, token);
  const direct = await viaGateway(() => githubGateway(source(token), env, fetcher).read(path));
  assert.deepEqual(direct, route);
  return route;
}

test('read success matches route', async () => {
  const fetcher = githubFetcher({
    '/repos/trvny/trvny': () => Response.json({ default_branch: 'main' }),
  });
  const outcome = await assertReadParity('/repos/trvny/trvny', fetcher);
  assert.deepEqual(outcome, { status: 200, body: { ok: true, data: { default_branch: 'main' } } });
});

test('read 404 matches route and readOptional returns null', async () => {
  const fetcher = githubFetcher({});
  const outcome = await assertReadParity('/repos/trvny/trvny/git/ref/heads/gone', fetcher);
  assert.equal(outcome.status, 404);
  assert.equal(
    await githubGateway(source(), env, fetcher).readOptional('/repos/trvny/trvny/git/ref/heads/gone'),
    null,
  );
});

test('readOptional keeps data and rethrows non-404', async () => {
  const fetcher = githubFetcher({
    '/repos/trvny/trvny/git/ref/heads/main': () => Response.json({ object: { sha: 'a' } }),
    '/repos/trvny/trvny/pulls': () => Response.json({ message: 'boom' }, { status: 500 }),
  });
  const github = githubGateway(source(), env, fetcher);
  assert.deepEqual(await github.readOptional('/repos/trvny/trvny/git/ref/heads/main'), {
    data: { object: { sha: 'a' } },
  });
  await assert.rejects(github.readOptional('/repos/trvny/trvny/pulls'), {
    code: 'github_500_boom',
    status: 500,
  });
});

test('read policy and auth failures match route', async () => {
  const fetcher = githubFetcher({});
  assert.equal((await assertReadParity('/repos/openai/openai', fetcher)).status, 403);
  assert.equal((await assertReadParity('/repos/trvny/trvny', fetcher, null)).status, 401);
  assert.equal((await assertReadParity('relative/path', fetcher)).status, 403);
  const stranger = githubFetcher({}, 'someone-else');
  const outcome = await assertReadParity('/repos/trvny/trvny', stranger);
  assert.deepEqual(outcome.body, { ok: false, error: 'github_user_not_allowed' });
});

test('transport exception matches route internal_error', async (t) => {
  t.mock.method(console, 'error', () => {});
  const fetcher = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  const outcome = await assertReadParity('/repos/trvny/trvny', fetcher);
  assert.deepEqual(outcome, { status: 500, body: { ok: false, error: 'internal_error' } });
});

test('graphql matches route, mutations rejected', async () => {
  const fetcher = githubFetcher({
    '/graphql': (init) => Response.json({ data: { echo: JSON.parse(String(init?.body)) } }),
  });
  for (const [query, variables] of [
    ['query { viewer { login } }', { a: 1 }],
    ['mutation { x }', undefined],
  ] as const) {
    const route = await viaRoute('graphql', { query, ...(variables ? { variables } : {}) }, fetcher);
    const direct = await viaGateway(() =>
      githubGateway(source(), env, fetcher).graphql(query, variables),
    );
    assert.deepEqual(direct, route);
  }
});

test('bot policy and size failures match route before any bot call', async () => {
  const fetcher = githubFetcher({});
  const github = githubGateway(source(), env, fetcher);
  const denied = await viaRoute('bot', { method: 'PATCH', path: '/repos/trvny/trvny/hooks/1' }, fetcher);
  assert.deepEqual(await viaGateway(() => github.bot('PATCH', '/repos/trvny/trvny/hooks/1')), denied);
  assert.equal(denied.status, 403);

  const body = { content: 'x'.repeat(260_000) };
  const path = '/repos/trvny/trvny/issues/1/comments';
  const tooLarge = await viaRoute('bot', { method: 'POST', path, body }, fetcher);
  assert.deepEqual(await viaGateway(() => github.bot('POST', path, body)), tooLarge);
  assert.equal(tooLarge.status, 413);
});
