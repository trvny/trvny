import assert from 'node:assert/strict';
import test from 'node:test';

import { handleReviewRouterRequest } from '../src/review-router.ts';

const endpoint = 'https://kanarek-companion.example/review-router/v1/chat/completions';

function request(token = 'router-token'): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'ignored', stream: true, messages: [{ role: 'user', content: 'x' }] }),
  });
}

test('review router rejects an invalid bearer before provider access', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(
    request('wrong'),
    { OPENROUTER_API_KEY: 'router-token' },
    (() => {
      calls += 1;
      return Promise.resolve(new Response());
    }) as typeof fetch,
  );

  assert.equal(response?.status, 401);
  assert.equal(calls, 0);
});

test('review router falls through AIHubMix quota failure to OpenRouter', async () => {
  const calls: Array<{ url: string; model: unknown; authorization: string | null }> = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: unknown };
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), model: body.model, authorization: headers.get('authorization') });
    if (calls.length === 1) return Promise.resolve(new Response('quota', { status: 429 }));
    return Promise.resolve(
      new Response('{"choices":[]}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;

  const response = await handleReviewRouterRequest(
    request(),
    {
      AIHUBMIX_API_KEY: 'aihubmix-key',
      OPENROUTER_API_KEY: 'router-token',
      ORCAROUTER_API_KEY: 'orca-key',
    },
    fetcher,
  );

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter');
  assert.deepEqual(
    calls.map(({ url, model }) => ({ url, model })),
    [
      { url: 'https://aihubmix.com/v1/chat/completions', model: 'coding-glm-5.3-free' },
      { url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openrouter/free' },
    ],
  );
  assert.equal(calls[0].authorization, 'Bearer aihubmix-key');
  assert.equal(calls[1].authorization, 'Bearer router-token');
});

test('review router stops on provider authentication failure', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(
    request(),
    { AIHUBMIX_API_KEY: 'bad-key', OPENROUTER_API_KEY: 'router-token' },
    (() => {
      calls += 1;
      return Promise.resolve(new Response('unauthorized', { status: 401 }));
    }) as typeof fetch,
  );

  assert.equal(response?.status, 502);
  assert.equal(calls, 1);
});

test('review router skips unconfigured providers and can reach OrcaRouter', async () => {
  const urls: string[] = [];
  const response = await handleReviewRouterRequest(
    request(),
    { OPENROUTER_API_KEY: 'router-token', ORCAROUTER_API_KEY: 'orca-key' },
    ((input: RequestInfo | URL) => {
      urls.push(String(input));
      if (urls.length === 1) return Promise.resolve(new Response('busy', { status: 503 }));
      return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
    }) as typeof fetch,
  );

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.deepEqual(urls, [
    'https://openrouter.ai/api/v1/chat/completions',
    'https://api.orcarouter.ai/v1/chat/completions',
  ]);
});
