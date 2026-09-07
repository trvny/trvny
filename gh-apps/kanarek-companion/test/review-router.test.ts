import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleReviewRouterRequest,
  reviewProviderPoolHealth,
  ReviewProviderCooldownStore,
} from '../src/review-router.ts';

const base = 'https://kanarek-companion.example/review-router/v1';
const endpoint = `${base}/chat/completions`;
const routerToken = 'router-token';

function request(
  token = routerToken,
  body: unknown = { model: 'ignored', stream: true, messages: [{ role: 'user', content: 'x' }] },
): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const auth = { KANAREK_REVIEW_ROUTER_TOKEN: routerToken } as const;


function workersAiBinding(
  run: (model: string, input: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Ai {
  return { run } as unknown as Ai;
}

function cooldownState(): DurableObjectState {
  const values = new Map<string, unknown>();
  return {
    storage: {
      get(key: string) {
        return values.get(key);
      },
      put(key: string, value: unknown) {
        values.set(key, value);
      },
      delete(key: string) {
        return values.delete(key);
      },
      deleteAll() {
        values.clear();
      },
      setAlarm() { return undefined; },
      deleteAlarm() { return undefined; },
    },
  } as unknown as DurableObjectState;
}

function cooldownNamespace(): DurableObjectNamespace {
  const stores = new Map<string, ReviewProviderCooldownStore>();
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get(id: DurableObjectId) {
      const key = id as unknown as string;
      let store = stores.get(key);
      if (!store) {
        store = new ReviewProviderCooldownStore(cooldownState());
        stores.set(key, store);
      }
      return {
        fetch(input: RequestInfo | URL, init?: RequestInit) {
          return store.fetch(new Request(input, init));
        },
      } as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
}

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

test('review router ignores paid Gemini credentials and prefers OpenRouter', async () => {
  let call: { url?: string; model?: unknown; authorization?: string | null } = {};
  const env = {
    ...auth, GEMINI_API_KEY: 'paid-quip-only-key', OPENROUTER_API_KEY: 'openrouter-key',
  };
  const response = await handleReviewRouterRequest(request(), env, ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: unknown };
    call = {
      url: String(input),
      model: body.model,
      authorization: new Headers(init?.headers).get('authorization'),
    };
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter');
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.model, 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.equal(call.authorization, 'Bearer openrouter-key');
});

test('review router normalizes Copilot tool follow-ups for free providers', async () => {
  const toolCalls = [{
    id: 'call_1',
    type: 'function',
    function: { name: 'view', arguments: '{"path":"/tmp/pr.diff"}' },
    extra_content: { google: { thought_signature: 'signed-context' } },
  }];
  let messages: unknown[] = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'ignored',
    stream: true,
    messages: [
      { role: 'user', content: 'review' },
      { role: 'assistant', content: null, refusal: null, tool_calls: toolCalls },
      { role: 'tool', tool_call_id: 'call_1', content: 'diff' },
    ],
  }), { ...auth, OPENROUTER_API_KEY: 'openrouter-key' }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages?: unknown[] };
    messages = body.messages ?? [];
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);
  assert.equal(response?.status, 200);
  const assistant = messages[1] as Record<string, unknown>;
  assert.equal('refusal' in assistant, false);
  assert.deepEqual(assistant.tool_calls, toolCalls);
  assert.deepEqual(messages[2], { role: 'tool', tool_call_id: 'call_1', content: 'diff' });
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
      model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
      models: [
        'poolside/laguna-s-2.1:free',
        'cohere/north-mini-code:free',
        'nvidia/nemotron-3-super-120b-a12b:free',
        'openrouter/free',
      ],
    },
    {
      url: 'https://api.orcarouter.ai/v1/chat/completions',
      model: 'orcarouter/free',
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

test('review cooldown store preserves a fresh extension when a stale alarm arrives', async () => {
  const store = new ReviewProviderCooldownStore(cooldownState());
  const extended = await store.fetch(new Request('https://review-cooldown.internal/extend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ category: 'http_429', durationMs: 600_000 }),
  }));
  assert.equal(extended.status, 200);

  await store.alarm();

  const active = await store.fetch(new Request('https://review-cooldown.internal/active'));
  const payload = (await active.json()) as { active?: boolean; category?: string };
  assert.equal(payload.active, true);
  assert.equal(payload.category, 'http_429');
});

test('review cooldown store never shortens an existing provider cooldown', async () => {
  const namespace = cooldownNamespace();
  const stub = namespace.get(namespace.idFromName('openrouter'));
  const extend = (category: string, durationMs: number) => stub.fetch(
    'https://review-cooldown.internal/extend',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ category, durationMs }),
    },
  );

  assert.equal((await extend('http_429', 600_000)).status, 200);
  assert.equal((await extend('http_503', 30_000)).status, 200);
  const active = await stub.fetch('https://review-cooldown.internal/active');
  const payload = (await active.json()) as { active?: boolean; category?: string };
  assert.equal(payload.active, true);
  assert.equal(payload.category, 'http_429');
});

test('review router cools down a quota-limited provider across Copilot retries', async () => {
  const env = {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key', ORCAROUTER_API_KEY: 'orca-key',
    KANAREK_REVIEW_COOLDOWNS: cooldownNamespace(),
  };
  const firstUrls: string[] = [];
  const first = await handleReviewRouterRequest(request(), env, ((input: RequestInfo | URL) => {
    firstUrls.push(String(input));
    if (firstUrls.length === 1) return Promise.resolve(new Response('quota', { status: 429 }));
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);
  assert.equal(first?.status, 200);
  assert.deepEqual(firstUrls, [
    'https://openrouter.ai/api/v1/chat/completions',
    'https://api.orcarouter.ai/v1/chat/completions',
  ]);

  const retryUrls: string[] = [];
  const retry = await handleReviewRouterRequest(request(), env, ((input: RequestInfo | URL) => {
    retryUrls.push(String(input));
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);
  assert.equal(retry?.status, 200);
  assert.deepEqual(retryUrls, ['https://api.orcarouter.ai/v1/chat/completions']);
});

test('review router fails fast while the whole free pool is quota-cooled', async () => {
  const env = {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key', ORCAROUTER_API_KEY: 'orca-key',
    AIHUBMIX_API_KEY: 'aihubmix-key', KANAREK_REVIEW_COOLDOWNS: cooldownNamespace(),
  };
  let calls = 0;
  const exhausted = await handleReviewRouterRequest(request(), env, ((input: RequestInfo | URL) => {
    calls += 1;
    if (new URL(String(input)).hostname === 'aihubmix.com') {
      return Promise.resolve(new Response(
        'data: {"choices":[{"delta":{"content":"to prevent abuse of free resources"}}]}\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ));
    }
    return Promise.resolve(new Response('quota', { status: 429 }));
  }) as typeof fetch);
  assert.equal(exhausted?.status, 429);
  assert.equal(calls, 3);

  const retry = await handleReviewRouterRequest(request(), env, (() => {
    calls += 1;
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);
  assert.equal(retry?.status, 429);
  assert.equal(calls, 3);
  const payload = (await retry?.json()) as { error?: { message?: string } };
  assert.match(payload.error?.message ?? '', /cooldown_http_429/);
  assert.match(payload.error?.message ?? '', /cooldown_soft_quota/);

  const health = await reviewProviderPoolHealth(env);
  assert.equal(health.configured, 3);
  assert.equal(health.available, 0);
  assert.equal(health.ready, false);
  assert.equal(
    health.providers.filter((provider) => provider.configured).every((provider) => provider.cooldown),
    true,
  );
});

test('review router prefers guarded Workers AI before HTTP free providers', async () => {
  let aiModel = '';
  let aiInput: Record<string, unknown> = {};
  const AI = workersAiBinding(async (model, input) => {
    aiModel = model;
    aiInput = input;
    return {
      id: 'cf-review',
      object: 'chat.completion',
      created: 1,
      model,
      choices: [],
    };
  });
  let httpCalls = 0;
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    AI,
    KANAREK_REVIEW_COOLDOWNS: cooldownNamespace(),
    OPENROUTER_API_KEY: 'openrouter-key',
    ORCAROUTER_API_KEY: 'orca-key',
    AIHUBMIX_API_KEY: 'aihubmix-key',
  }, (() => {
    httpCalls += 1;
    return Promise.resolve(new Response('quota', { status: 429 }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'workers-ai');
  assert.equal(httpCalls, 0);
  assert.equal(aiModel, '@cf/zai-org/glm-4.7-flash');
  assert.equal(aiInput.stream, false);
  assert.equal('model' in aiInput, false);
  const payload = (await response?.json()) as { model?: string };
  assert.equal(payload.model, '@cf/zai-org/glm-4.7-flash');
});

test('review router bounds a stalled Workers AI binding', async () => {
  const AI = workersAiBinding(() => new Promise(() => {}));
  const startedAt = Date.now();
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    AI,
    KANAREK_REVIEW_ROUTER_TIMEOUT_MS: '1000',
    KANAREK_REVIEW_COOLDOWNS: cooldownNamespace(),
  });

  assert.equal(response?.status, 502);
  assert.ok(Date.now() - startedAt < 2_000);
  const payload = (await response?.json()) as { error?: { message?: string } };
  assert.match(payload.error?.message ?? '', /workers-ai:timeout/);
});

test('review provider health includes the Workers AI binding', async () => {
  const AI = workersAiBinding(async () => ({}));
  const health = await reviewProviderPoolHealth({ ...auth, AI, KANAREK_REVIEW_COOLDOWNS: cooldownNamespace() });
  assert.equal(health.configured, 1);
  assert.equal(health.available, 1);
  assert.equal(health.ready, true);
  assert.deepEqual(
    health.providers.find((provider) => provider.provider === 'workers-ai'),
    { available: true, configured: true, provider: 'workers-ai' },
  );
});


test('review provider state hard-caps Workers AI neuron reservations', async () => {
  const namespace = cooldownNamespace();
  const stub = namespace.get(namespace.idFromName('workers-ai'));
  const reserve = (neurons: number) => stub.fetch('https://review-cooldown.internal/reserve-neurons', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ day: '2026-09-07', neurons, limit: 100 }),
  });

  assert.equal((await reserve(60)).status, 200);
  const rejected = await reserve(50);
  assert.equal(rejected.status, 429);
  const payload = (await rejected.json()) as { allowed?: boolean; reserved?: number };
  assert.equal(payload.allowed, false);
  assert.equal(payload.reserved, 60);
  assert.equal((await reserve(40)).status, 200);
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

test('review router retries OpenRouter primary-only after a fallback-chain 400', async () => {
  const bodies: Array<{ model?: unknown; models?: unknown }> = [];
  const response = await handleReviewRouterRequest(request(), {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as { model?: unknown; models?: unknown });
    if (bodies.length === 1) return Promise.resolve(new Response('fallback list rejected', { status: 400 }));
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter');
  assert.equal(bodies.length, 2);
  assert.ok(Array.isArray(bodies[0].models));
  assert.equal('models' in bodies[1], false);
});

test('review router falls through after both OpenRouter 400 attempts fail', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(request(), {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key', ORCAROUTER_API_KEY: 'orca-key',
  }, (() => {
    calls += 1;
    if (calls <= 2) return Promise.resolve(new Response('model rejected request', { status: 400 }));
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.equal(calls, 3);
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


test('review router tries Ollama models before Groq as the final HTTP fallback', async () => {
  const calls: Array<{ url: string; model: unknown }> = [];
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    OLLAMA_API_KEY: 'ollama-key',
    GROQ_API_KEY: 'groq-key',
  }, ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: unknown };
    calls.push({ url: String(input), model: body.model });
    if (String(input).startsWith('https://ollama.com/')) {
      return Promise.resolve(new Response('model unavailable', { status: 404 }));
    }
    return Promise.resolve(new Response('{"choices":[]}', { status: 200 }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'groq');
  assert.deepEqual(calls, [
    { url: 'https://ollama.com/v1/chat/completions', model: 'glm-5.3-flash' },
    { url: 'https://ollama.com/v1/chat/completions', model: 'gpt-oss:120b' },
    { url: 'https://ollama.com/v1/chat/completions', model: 'gpt-oss:20b' },
    { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b' },
  ]);
});

test('review router treats AIHubMix HTTP 200 quota text as exhausted', async () => {
  const response = await handleReviewRouterRequest(request(), {
    ...auth, AIHUBMIX_API_KEY: 'aihubmix-key',
  }, (() => Promise.resolve(new Response(
    'data: {"choices":[{"delta":{"content":"Sorry, to prevent abuse of free resources."}}]}\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  ))) as typeof fetch);

  assert.equal(response?.status, 429);
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
  assert.equal(calls, 3);
  const payload = (await response?.json()) as { error?: { code?: string } };
  assert.equal(payload.error?.code, 'invalid_request');
});

test('review router treats an unreadable upstream 400 as provider failure', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(new Error('upstream body read failed'));
    },
  });
  const response = await handleReviewRouterRequest(request(), {
    ...auth, ORCAROUTER_API_KEY: 'orca-key',
  }, (() => Promise.resolve(new Response(body, { status: 400 }))) as typeof fetch);

  assert.equal(response?.status, 502);
  const payload = (await response?.json()) as { error?: { message?: string; code?: string } };
  assert.equal(payload.error?.code, 'review_router_exhausted');
  assert.equal(payload.error?.message, 'Review providers unavailable (orcarouter:http_400_unreadable)');
});

test('review router reports bounded provider diagnostics without upstream bodies', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(request(), {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key',
    ORCAROUTER_API_KEY: 'orca-key', AIHUBMIX_API_KEY: 'aihubmix-key',
  }, ((input: RequestInfo | URL) => {
    calls += 1;
    const hostname = new URL(String(input)).hostname;
    if (hostname === 'openrouter.ai') {
      return Promise.resolve(new Response(`SECRET-UPSTREAM-BODY-${calls}`, { status: 429 }));
    }
    if (hostname === 'api.orcarouter.ai') {
      return Promise.resolve(new Response(`SECRET-UPSTREAM-BODY-${calls}`, { status: 503 }));
    }
    return Promise.resolve(new Response(
      'data: {"choices":[{"delta":{"content":"accounts that have not been recharged can only try 10 times"}}]}\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));
  }) as typeof fetch);

  assert.equal(response?.status, 502);
  const payload = (await response?.json()) as { error?: { message?: string; code?: string } };
  assert.equal(payload.error?.code, 'review_router_exhausted');
  assert.equal(
    payload.error?.message,
    'Review providers unavailable (openrouter:http_429, orcarouter:http_503, aihubmix:soft_quota)',
  );
  assert.equal(JSON.stringify(payload).includes('SECRET-UPSTREAM-BODY'), false);
  assert.equal(JSON.stringify(payload).includes('accounts that have not been recharged'), false);
});

test('review router classifies a bad parameter without exposing the upstream body', async () => {
  const response = await handleReviewRouterRequest(request(), {
    ...auth, ORCAROUTER_API_KEY: 'orca-key',
  }, (() => Promise.resolve(new Response(
    '{"error":{"message":"Unknown field stream_options SECRET-UPSTREAM-BODY"}}',
    { status: 400 },
  ))) as typeof fetch);

  assert.equal(response?.status, 400);
  const payload = (await response?.json()) as { error?: { message?: string } };
  assert.equal(payload.error?.message, 'Invalid review request (orcarouter:http_400_unsupported_parameter)');
  assert.equal(JSON.stringify(payload).includes('SECRET-UPSTREAM-BODY'), false);
});

test('review router rejects provider credentials as router bearer', async () => {
  const response = await handleReviewRouterRequest(request('openrouter-key'), {
    KANAREK_REVIEW_ROUTER_TOKEN: routerToken, OPENROUTER_API_KEY: 'openrouter-key',
  });
  assert.equal(response?.status, 401);
});


test('review router accepts common false values for the Workers AI switch', async () => {
  const AI = workersAiBinding(async () => ({}));
  for (const value of ['false', '0', 'no', 'off', 'OFF']) {
    const health = await reviewProviderPoolHealth({
      ...auth,
      AI,
      KANAREK_REVIEW_COOLDOWNS: cooldownNamespace(),
      KANAREK_REVIEW_WORKERS_AI_ENABLED: value,
    });
    assert.equal(health.configured, 0, value);
    assert.equal(health.ready, false, value);
  }
});

test('review provider health reports an exhausted Workers AI daily budget as unavailable', async () => {
  const namespace = cooldownNamespace();
  const stub = namespace.get(namespace.idFromName('workers-ai'));
  const day = new Date().toISOString().slice(0, 10);
  const reserved = await stub.fetch('https://review-cooldown.internal/reserve-neurons', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ day, neurons: 100, limit: 100 }),
  });
  assert.equal(reserved.status, 200);

  const health = await reviewProviderPoolHealth({
    ...auth,
    AI: workersAiBinding(async () => ({})),
    KANAREK_REVIEW_COOLDOWNS: namespace,
    KANAREK_REVIEW_WORKERS_AI_DAILY_NEURONS: '100',
  });
  assert.equal(health.configured, 1);
  assert.equal(health.available, 0);
  assert.equal(health.ready, false);
});

test('review router classifies a failed Workers AI budget reservation as transient', async () => {
  const cooldownCategories: string[] = [];
  const namespace = {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        fetch(input: RequestInfo | URL, init?: RequestInit) {
          const pathname = new URL(String(input)).pathname;
          if (pathname === '/active') return Promise.resolve(Response.json({ active: false }));
          if (pathname === '/reserve-neurons') return Promise.resolve(new Response('down', { status: 500 }));
          if (pathname === '/extend') {
            const body = JSON.parse(String(init?.body)) as { category?: string };
            if (body.category) cooldownCategories.push(body.category);
            return Promise.resolve(Response.json({ ok: true, category: body.category, until: Date.now() + 30_000 }));
          }
          return Promise.resolve(new Response('not found', { status: 404 }));
        },
      } as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;

  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    AI: workersAiBinding(async () => ({ choices: [] })),
    KANAREK_REVIEW_COOLDOWNS: namespace,
    OPENROUTER_API_KEY: 'openrouter-key',
  }, (() => Promise.resolve(new Response('{"choices":[]}', { status: 200 }))) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter');
  assert.deepEqual(cooldownCategories, ['network']);
});
