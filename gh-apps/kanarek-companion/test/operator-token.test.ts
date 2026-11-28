import assert from 'node:assert/strict';
import test from 'node:test';

import { createActionFetch, runWithActionRequestContext } from '../src/action-context.ts';
import { GithubActionError, requireTrvny } from '../src/gptomek/github-gateway.ts';
import { OPERATOR_APP_ID, OPERATOR_USER_ID, operatorInstallations } from './support/operator-identity.ts';

const OWNER = { login: 'trvny', id: OPERATOR_USER_ID };

function github(
  installations: () => Response,
  user: Record<string, unknown> = OWNER,
  calls: string[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(new Request(input, init).url);
    calls.push(url.pathname);
    if (url.pathname === '/user') return Response.json(user);
    if (url.pathname === '/user/installations') return installations();
    return Response.json({ message: 'Not Found' }, { status: 404 });
  }) as typeof fetch;
}

async function rejects(fetcher: typeof fetch, status: number, code: string | RegExp): Promise<void> {
  await assert.rejects(requireTrvny('token', fetcher), (error: unknown) => {
    assert.ok(error instanceof GithubActionError, String(error));
    assert.equal(error.status, status);
    if (typeof code === 'string') assert.equal(error.code, code);
    else assert.match(error.code, code);
    return true;
  });
}

test('operator check accepts a user token of the GPTomek App', async () => {
  const user = await requireTrvny('token', github(() => operatorInstallations()));
  assert.equal(user.login, 'trvny');
});

test('operator check accepts several installations of the same App', async () => {
  await requireTrvny('token', github(() => operatorInstallations(OPERATOR_APP_ID, OPERATOR_APP_ID)));
});

test('operator check rejects OAuth app tokens and personal access tokens', async () => {
  // Body GitHub returned for a classic OAuth token on 2026-11-28.
  const refusal = () => Response.json(
    { message: 'You must authenticate with an access token authorized to a GitHub App in order to list installations' },
    { status: 403 },
  );
  await rejects(github(refusal), 403, 'github_token_app_not_allowed');
});

test('operator check rejects a user token of another GitHub App', async () => {
  await rejects(github(() => operatorInstallations(4472094)), 403, 'github_token_app_not_allowed');
});

test('operator check rejects a list that only partly belongs to the App', async () => {
  await rejects(github(() => operatorInstallations(OPERATOR_APP_ID, 4472094)), 403, 'github_token_app_not_allowed');
});

test('operator check fails closed on an empty or malformed installation list', async () => {
  await rejects(github(() => Response.json({ total_count: 0, installations: [] })), 403, 'github_token_app_not_allowed');
  await rejects(github(() => Response.json({})), 403, 'github_token_app_not_allowed');
  await rejects(github(() => Response.json({ installations: [null] })), 403, 'github_token_app_not_allowed');
});

test('operator check keeps unrelated GitHub failures visible and still denies', async () => {
  await rejects(
    github(() => Response.json({ message: 'API rate limit exceeded' }, { status: 403 })),
    403,
    /rate limit/,
  );
  await rejects(github(() => new Response('', { status: 502 })), 502, 'github_502');
});

test('operator check rejects another account before reading installations', async () => {
  for (const user of [{ login: 'trvny', id: 1 }, { login: 'someone', id: OPERATOR_USER_ID }]) {
    const calls: string[] = [];
    await rejects(github(() => operatorInstallations(), user, calls), 403, 'github_user_not_allowed');
    assert.deepEqual(calls, ['/user']);
  }
});

test('both identity reads are cached per token across requests', async () => {
  const calls: string[] = [];
  const fetcher = createActionFetch(github(() => operatorInstallations(), OWNER, calls));
  await runWithActionRequestContext(() => requireTrvny('cached-token', fetcher));
  await runWithActionRequestContext(() => requireTrvny('cached-token', fetcher));
  assert.deepEqual(calls, ['/user', '/user/installations']);
  await runWithActionRequestContext(() => requireTrvny('other-token', fetcher));
  assert.equal(calls.length, 4);
});
