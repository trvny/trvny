import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addEngramOpenApi,
  handleEngramAction,
  type EngramActionEnv,
} from '../src/engram-actions.ts';

const origin = 'https://example.workers.dev';

function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Request {
  return new Request(`${origin}${path}`, {
    method,
    headers: {
      authorization: 'Bearer github-oauth-token',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function authorizedInvoke(expectedToken = 'Bearer github-oauth-token') {
  return async (input: Request): Promise<Response> => {
    assert.equal(new URL(input.url).pathname, '/gpt-actions/github/read');
    assert.equal(input.method, 'POST');
    assert.equal(input.headers.get('authorization'), expectedToken);
    assert.deepEqual(await input.json(), { path: '/user' });
    return Response.json({ ok: true, data: { login: 'trvny' } });
  };
}

function fakeResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function unexpectedFetch(message: string): typeof fetch {
  return () => Promise.reject(new Error(message));
}

test('Engram Actions expose OAuth-protected status/search/store operations', () => {
  const document: Record<string, unknown> = { paths: {} };
  addEngramOpenApi(document);
  const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;
  assert.equal(paths['/gpt-actions/engram/status'].get.operationId, 'getEngramStatus');
  assert.equal(paths['/gpt-actions/engram/search'].post.operationId, 'searchEngramMemory');
  assert.equal(paths['/gpt-actions/engram/store'].post.operationId, 'storeEngramMemory');
  for (const operation of [
    paths['/gpt-actions/engram/status'].get,
    paths['/gpt-actions/engram/search'].post,
    paths['/gpt-actions/engram/store'].post,
  ]) {
    assert.deepEqual(operation.security, [{ githubOAuth: [] }]);
  }
});

test('operator authorization is checked before Engram or its credential is touched', async () => {
  let upstreamCalls = 0;
  const invoke = (): Promise<Response> =>
    Promise.resolve(Response.json({ ok: false, error: 'github_user_not_allowed' }, { status: 403 }));
  const fetcher: typeof fetch = () => {
    upstreamCalls += 1;
    return Promise.reject(new Error('Engram must not be called'));
  };
  const response = await handleEngramAction(
    request('/gpt-actions/engram/search', { query: 'private memory' }),
    { ENGRAM_API_KEY: 'eng_live_super_secret' },
    invoke,
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes('eng_live_super_secret'), false);
  assert.equal(upstreamCalls, 0);
});

test('a forged successful identity response still fails closed', async () => {
  const invoke = (): Promise<Response> =>
    Promise.resolve(Response.json({ ok: true, data: { login: 'someone-else' } }));
  const response = await handleEngramAction(
    request('/gpt-actions/engram/status'),
    { ENGRAM_API_KEY: 'eng_live_test' },
    invoke,
    unexpectedFetch('Engram must not be called'),
  );
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: 'operator_not_allowed' });
});

test('status never exposes the server-side Engram credential', async () => {
  const env = { ENGRAM_API_KEY: 'eng_live_super_secret' } satisfies EngramActionEnv;
  const fetcher: typeof fetch = (input, init) => {
    assert.equal(String(input), 'https://api.engrammemory.ai/v1/health');
    assert.equal(init?.method, 'GET');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer eng_live_super_secret');
    assert.equal(headers.get('x-api-version'), '1');
    return Promise.resolve(fakeResponse({ status: 'ok' }));
  };
  const response = await handleEngramAction(
    request('/gpt-actions/engram/status'),
    env,
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes('eng_live_super_secret'), false);
  assert.deepEqual(JSON.parse(text), { ok: true, configured: true, reachable: true });
});

test('search sends a bounded personal query with the server-side credential', async () => {
  const env = { ENGRAM_API_KEY: 'eng_live_test' } satisfies EngramActionEnv;
  const fetcher: typeof fetch = (input, init) => {
    assert.equal(String(input), 'https://api.engrammemory.ai/v1/search');
    assert.equal(init?.method, 'POST');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer eng_live_test');
    assert.equal(headers.get('x-api-version'), '1');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      query: 'what did we decide about retries?',
      top_k: 4,
      scope: 'personal',
    });
    return Promise.resolve(fakeResponse({
      results: [{ id: 'm1', content: 'Use backoff.', score: 0.9 }],
      query_tokens: 7,
    }));
  };
  const response = await handleEngramAction(
    request('/gpt-actions/engram/search', {
      query: 'what did we decide about retries?',
      limit: 4,
    }),
    env,
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    results: [{
      id: 'm1',
      content: 'Use backoff.',
      category: null,
      score: 0.9,
      confidence: null,
      matchContext: null,
      tier: null,
      importance: null,
      timestamp: null,
      metadata: null,
    }],
    queryTokens: 7,
  });
});

test('store stamps MechaGremlin source and keeps memory fields bounded', async () => {
  const env = { ENGRAM_API_KEY: 'eng_live_test' } satisfies EngramActionEnv;
  const fetcher: typeof fetch = (input, init) => {
    assert.equal(String(input), 'https://api.engrammemory.ai/v1/store');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer eng_live_test');
    assert.equal(headers.get('x-api-version'), '1');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      text: 'Prefer squash merges.',
      category: 'preference',
      importance: 0.8,
      metadata: { project: 'trvny/trvny', source: 'mechagremlin' },
      collection: 'agent-memory',
    });
    return Promise.resolve(fakeResponse({
      id: 'm2',
      status: 'stored',
      category: 'preference',
      duplicate: false,
      message: 'Memory stored [preference]',
    }));
  };
  const response = await handleEngramAction(
    request('/gpt-actions/engram/store', {
      text: 'Prefer squash merges.',
      category: 'preference',
      importance: 0.8,
      metadata: { project: 'trvny/trvny' },
    }),
    env,
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    id: 'm2',
    status: 'stored',
    category: 'preference',
    duplicate: false,
    message: 'Memory stored [preference]',
  });
});

test('Engram actions fail closed when the credential or input is invalid', async () => {
  const noSecret = await handleEngramAction(
    request('/gpt-actions/engram/search', { query: 'test' }),
    {},
    authorizedInvoke(),
    unexpectedFetch('Engram must not be called without a credential'),
  );
  assert.ok(noSecret);
  assert.equal(noSecret.status, 503);
  assert.deepEqual(await noSecret.json(), { ok: false, error: 'engram_unconfigured' });

  const invalid = await handleEngramAction(
    request('/gpt-actions/engram/store', { text: 'x', category: 'made-up' }),
    { ENGRAM_API_KEY: 'eng_live_test' },
    authorizedInvoke(),
    unexpectedFetch('Engram must not be called for invalid input'),
  );
  assert.ok(invalid);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { ok: false, error: 'invalid_category' });
});

test('upstream error bodies are never relayed to the Custom GPT', async () => {
  const fetcher: typeof fetch = () =>
    Promise.resolve(new Response('secret upstream diagnostic', { status: 401 }));
  const response = await handleEngramAction(
    request('/gpt-actions/engram/search', { query: 'test' }),
    { ENGRAM_API_KEY: 'eng_live_bad' },
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: 'engram_auth_failed' });
});
