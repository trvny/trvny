import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createActionFetch,
  runWithActionRequestContext,
} from '../src/action-context.ts';

function fakeAppJwt(issuer: string, nonce: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: issuer, nonce })).toString('base64url');
  return `${header}.${payload}.signature`;
}

test('reuses a recent GitHub user verification for the same OAuth token', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => {
    calls += 1;
    return Response.json({ login: 'trvny', id: 120686325 });
  };
  const optimized = createActionFetch(upstream);
  const init = { headers: { Authorization: 'Bearer user-token' } };

  const first = await optimized('https://api.github.com/user', init);
  const second = await optimized('https://api.github.com/user', init);

  assert.equal((await first.json() as { login: string }).login, 'trvny');
  assert.equal((await second.json() as { login: string }).login, 'trvny');
  assert.equal(calls, 1);
});

test('deduplicates concurrent user verification requests', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json({ login: 'trvny' });
  };
  const optimized = createActionFetch(upstream);
  const init = { headers: { Authorization: 'Bearer concurrent-token' } };

  const responses = await Promise.all([
    optimized('https://api.github.com/user', init),
    optimized('https://api.github.com/user', init),
    optimized('https://api.github.com/user', init),
  ]);
  await Promise.all(responses.map((response) => response.json()));

  assert.equal(calls, 1);
});

test('reuses a GPTomek installation token until its refresh window', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => {
    calls += 1;
    return Response.json({
      token: 'ghs_cached_token',
      expires_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      permissions: { contents: 'write', actions: 'read' },
    });
  };
  const optimized = createActionFetch(upstream);
  const url = 'https://api.github.com/app/installations/152126523/access_tokens';

  const first = await optimized(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fakeAppJwt('4524407', 1)}` },
  });
  const second = await optimized(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${fakeAppJwt('4524407', 2)}` },
  });

  assert.equal((await first.json() as { token: string }).token, 'ghs_cached_token');
  assert.equal((await second.json() as { token: string }).token, 'ghs_cached_token');
  assert.equal(calls, 1);
});

test('does not cache unrelated GitHub writes', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => {
    calls += 1;
    return Response.json({ ok: true });
  };
  const optimized = createActionFetch(upstream);

  await optimized('https://api.github.com/repos/trvny/trvny/issues/1/comments', {
    method: 'POST',
    headers: { Authorization: 'Bearer write-token' },
    body: JSON.stringify({ body: 'one' }),
  });
  await optimized('https://api.github.com/repos/trvny/trvny/issues/1/comments', {
    method: 'POST',
    headers: { Authorization: 'Bearer write-token' },
    body: JSON.stringify({ body: 'two' }),
  });

  assert.equal(calls, 2);
});

test('memoizes identical GitHub GETs only inside one action request context', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => {
    calls += 1;
    return Response.json({ call: calls });
  };
  const optimized = createActionFetch(upstream);
  const url = 'https://api.github.com/repos/trvny/trvny';
  const init = { headers: { Authorization: 'Bearer scoped-token' } };

  await runWithActionRequestContext(async () => {
    const [first, second] = await Promise.all([
      optimized(url, init),
      optimized(url, init),
    ]);
    assert.equal((await first.json() as { call: number }).call, 1);
    assert.equal((await second.json() as { call: number }).call, 1);
  });
  assert.equal(calls, 1);

  await runWithActionRequestContext(async () => {
    const response = await optimized(url, init);
    assert.equal((await response.json() as { call: number }).call, 2);
  });
  assert.equal(calls, 2);
});

test('invalidates request-local GET memoization before a GitHub mutation', async () => {
  let calls = 0;
  const upstream: typeof fetch = async (input, init) => {
    calls += 1;
    const request = new Request(input, init);
    return Response.json({ call: calls, method: request.method });
  };
  const optimized = createActionFetch(upstream);
  const url = 'https://api.github.com/repos/trvny/trvny/git/ref/heads/main';
  const headers = { Authorization: 'Bearer scoped-token' };

  await runWithActionRequestContext(async () => {
    const first = await optimized(url, { headers });
    assert.equal((await first.json() as { call: number }).call, 1);

    await optimized('https://api.github.com/repos/trvny/trvny/issues/1/comments', {
      method: 'POST',
      headers,
      body: JSON.stringify({ body: 'mutation' }),
    });

    const afterMutation = await optimized(url, { headers });
    assert.equal((await afterMutation.json() as { call: number }).call, 3);
  });
  assert.equal(calls, 3);
});
