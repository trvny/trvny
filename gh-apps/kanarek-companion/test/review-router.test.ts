import assert from 'node:assert/strict';
import test from 'node:test';

import { handleReviewRouterRequest } from '../src/review-router.ts';

const base = 'https://kanarek-companion.example/review-router/v1';
const endpoint = `${base}/chat/completions`;
const routerToken = 'router-token';

function request(token = routerToken): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'ignored', stream: true, messages: [{ role: 'user', content: 'x' }] }),
  });
}

const auth = { KANAREK_REVIEW_ROUTER_TOKEN: routerToken } as const;

test('review router rejects an invalid bearer before provider access', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(request('wrong'), {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key',
  }, (() => {
    calls += 1;
    return Promise.resolve(new Response());
  }) as typeof fetch);

  assert.equal(response?.status, 401);
  assert.equal(calls, 0);
});

test('review router exposes its synthetic OpenAI model', async () => {
  const response = await handleReviewRouterRequest(new Request(`${base}/models`, {
    headers: { Authorization: `Bearer ${routerToken}` },
  }), auth);
  assert.equal(response?.status, 200);
  const payload = (await response?.json()) as { data?: Array<{ id?: string }> };
  assert.equal(payload.data?.[0]?.id, 'kanarek-review-free');
});

test('review router prefers OpenRouter then falls through to OrcaRouter', async () => {
  const calls: Array<{ url: string; model: unknown; models: unknown; authorization: string | null }> = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: unknown; models?: unknown };
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input), model: body.model, models: body.models,
      authorization: headers.get('authorization'),
    });
    if (calls.length === 1) return Promise.resolve(new Response('quota', { status: 429 }));
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch;

  const response = await handleReviewRouterRequest(request(), {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key', ORCAROUTER_API_KEY: 'orca-key',
    AIHUBMIX_API_KEY: 'aihubmix-key',
  }, fetcher);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.deepEqual(calls.map(({ url, model, models }) => ({ url, model, models })), [
    {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'minimax/minimax-m3:free',
      models: [
        'nvidia/nemotron-3-ultra-550b-a55b:free',
        'poolside/laguna-s-2.1:free',
        'cohere/north-mini-code:free',
        'poolside/laguna-m.1:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'openrouter/free',
      ],
    },
    {
      url: 'https://api.orcarouter.ai/v1/chat/completions',
      model: 'deepseek/deepseek-v4-flash-free',
      models: undefined,
    },
  ]);
  assert.equal(calls[0].authorization, 'Bearer openrouter-key');
  assert.equal(calls[1].authorization, 'Bearer orca-key');
});

test('review router honors the shared configured OpenRouter model chain', async () => {
  let body: { model?: unknown; models?: unknown } = {};
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    KANAREK_OPENROUTER_MODELS: 'first/free, second/free,first/free',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as { model?: unknown; models?: unknown };
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(body.model, 'first/free');
  assert.deepEqual(body.models, ['second/free']);
});

test('review router falls through provider authentication errors', async () => {
  const urls: string[] = [];
  const response = await handleReviewRouterRequest(request(), {
    ...auth, OPENROUTER_API_KEY: 'bad-openrouter-key', ORCAROUTER_API_KEY: 'orca-key',
  }, ((input: RequestInfo | URL) => {
    urls.push(String(input));
    if (urls.length === 1) return Promise.resolve(new Response('forbidden', { status: 403 }));
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.equal(urls.length, 2);
});

test('review router falls through a provider-specific 400', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(request(), {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key', ORCAROUTER_API_KEY: 'orca-key',
  }, (() => {
    calls += 1;
    if (calls === 1) return Promise.resolve(new Response('model rejected request', { status: 400 }));
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.equal(calls, 2);
});
test('review router reaches AIHubMix after earlier providers fail', async () => {
  const urls: string[] = [];
  const response = await handleReviewRouterRequest(request(), {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key', ORCAROUTER_API_KEY: 'orca-key',
    AIHUBMIX_API_KEY: 'aihubmix-key',
  }, ((input: RequestInfo | URL) => {
    urls.push(String(input));
    if (urls.length < 3) return Promise.resolve(new Response('busy', { status: 503 }));
    return Promise.resolve(new Response('data: {"choices":[]}\n\n', {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'aihubmix');
  assert.deepEqual(urls, [
    'https://openrouter.ai/api/v1/chat/completions',
    'https://api.orcarouter.ai/v1/chat/completions',
    'https://aihubmix.com/v1/chat/completions',
  ]);
});

test('review router treats AIHubMix HTTP 200 quota text as exhausted', async () => {
  const response = await handleReviewRouterRequest(request(), {
    ...auth, AIHUBMIX_API_KEY: 'aihubmix-key',
  }, (() => Promise.resolve(new Response(
    'data: {"choices":[{"delta":{"content":"Sorry, to prevent abuse of free resources."}}]}\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  ))) as typeof fetch);

  assert.equal(response?.status, 502);
});

test('review router preserves a normal AIHubMix stream after previewing it', async () => {
  const stream = 'data: {"choices":[{"delta":{"content":"正常。"}}]}\n\n';
  const response = await handleReviewRouterRequest(request(), {
    ...auth, AIHUBMIX_API_KEY: 'aihubmix-key',
  }, (() => Promise.resolve(new Response(stream, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  }))) as typeof fetch);

  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'aihubmix');
  assert.equal(await response?.text(), stream);
});

test('review router recognizes CRLF SSE boundaries without buffering the stream', async () => {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
      value.enqueue(encoder.encode('data: {"choices":[]}\r\n\r\n'));
    },
  });
  const startedAt = Date.now();
  const response = await handleReviewRouterRequest(request(), {
    ...auth, AIHUBMIX_API_KEY: 'aihubmix-key', KANAREK_REVIEW_ROUTER_TIMEOUT_MS: '1000',
  }, (() => Promise.resolve(new Response(body, {
    status: 200, headers: { 'content-type': 'text/event-stream' },
  }))) as typeof fetch);

  assert.ok(Date.now() - startedAt < 500);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'aihubmix');
  controller?.close();
  await response?.body?.cancel();
});

test('review router bounds a stalled AIHubMix preview', async () => {
  const { readable: stalled } = new TransformStream<Uint8Array, Uint8Array>();
  const startedAt = Date.now();
  const response = await handleReviewRouterRequest(request(), {
    ...auth, AIHUBMIX_API_KEY: 'aihubmix-key', KANAREK_REVIEW_ROUTER_TIMEOUT_MS: '1000',
  }, (() => Promise.resolve(new Response(stalled, { status: 200 }))) as typeof fetch);

  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs >= 900 && elapsedMs < 2000);
  assert.equal(response?.status, 502);
});

test('review router returns an upstream 400 as an invalid client request', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(request(), {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key', ORCAROUTER_API_KEY: 'orca-key',
  }, (() => {
    calls += 1;
    return Promise.resolve(new Response('bad request details', { status: 400 }));
  }) as typeof fetch);

  assert.equal(response?.status, 400);
  assert.equal(calls, 2);
  const payload = (await response?.json()) as { error?: { code?: string } };
  assert.equal(payload.error?.code, 'invalid_request');
});

test('review router rejects provider credentials as router bearer', async () => {
  const response = await handleReviewRouterRequest(request('openrouter-key'), {
    KANAREK_REVIEW_ROUTER_TOKEN: routerToken, OPENROUTER_API_KEY: 'openrouter-key',
  });
  assert.equal(response?.status, 401);
});
