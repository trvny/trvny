import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fitProviderAttemptTokenBudget,
  handleReviewRouterRequest,
  REVIEW_ROUTER_MODEL_DEFAULTS,
  reviewFreeProbeTimeoutMs,
  reviewProviderPoolHealth,
  reviewRouterTaskProfile,
  taskProviderTimeoutMs,
} from '../src/review-router.ts';
import { ReviewProviderCooldownStore } from '../../kanarek-companion/src/review-cooldown-store.ts';
import { REVIEW_PROVIDER_EXCLUDE_HEADER } from '../../kanarek-companion/src/review-service-protocol.ts';

const base = 'https://kanarek-review.example/review-router/v1';
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

test('free router skips a successful provider response with no assistant content', async () => {
  const calls: string[] = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    messages: [{ role: 'user', content: 'write one short quip' }],
  }), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    ORCAROUTER_API_KEY: 'orca-key',
  }, ((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('openrouter.ai')) {
      return Promise.resolve(Response.json({
        model: 'empty-free-model',
        choices: [{ finish_reason: 'length', message: { role: 'assistant', content: '' } }],
      }));
    }
    return Promise.resolve(Response.json({
      model: 'fallback-free-model',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'fallback worked' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.equal(
    calls.length,
    REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_OPENROUTER_MODELS.length + 2,
  );
  assert.deepEqual(
    calls.slice(0, -1),
    Array(REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_OPENROUTER_MODELS.length + 1)
      .fill('https://openrouter.ai/api/v1/chat/completions'),
  );
  assert.equal(calls[calls.length - 1], 'https://api.orcarouter.ai/v1/chat/completions');
  const payload = (await response?.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  assert.equal(payload.choices?.[0]?.message?.content, 'fallback worked');
});

test('free router preserves an explicit refusal instead of bypassing it', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    messages: [{ role: 'user', content: 'request' }],
  }), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    ORCAROUTER_API_KEY: 'orca-key',
  }, (() => {
    calls += 1;
    return Promise.resolve(Response.json({
      choices: [{ message: { role: 'assistant', content: null, refusal: 'Cannot comply.' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter');
  assert.equal(calls, 1);
});

test('review router excludes the reviewer provider for an independent judge call', async () => {
  const calls: string[] = [];
  const judgeRequest = new Request(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${routerToken}`,
      'Content-Type': 'application/json',
      [REVIEW_PROVIDER_EXCLUDE_HEADER]: 'openrouter',
    },
    body: JSON.stringify({
      model: 'kanarek-review-free',
      stream: false,
      messages: [{ role: 'user', content: 'judge' }],
    }),
  });
  const response = await handleReviewRouterRequest(judgeRequest, {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    ORCAROUTER_API_KEY: 'orca-key',
  }, ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(Response.json({
      model: 'different/free-model',
      choices: [{ message: { role: 'assistant', content: '{}' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.deepEqual(calls, ['https://api.orcarouter.ai/v1/chat/completions']);
});

test('review router fails closed when the judge excludes the only configured provider', async () => {
  let calls = 0;
  const judgeRequest = new Request(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${routerToken}`,
      'Content-Type': 'application/json',
      [REVIEW_PROVIDER_EXCLUDE_HEADER]: 'orcarouter',
    },
    body: JSON.stringify({
      model: 'kanarek-review-free',
      stream: false,
      messages: [{ role: 'user', content: 'judge' }],
    }),
  });
  const response = await handleReviewRouterRequest(judgeRequest, {
    ...auth,
    ORCAROUTER_API_KEY: 'orca-key',
  }, (() => {
    calls += 1;
    return Promise.resolve(new Response());
  }) as typeof fetch);

  assert.equal(response?.status, 503);
  assert.equal(calls, 0);
});

test('review router exposes its synthetic OpenAI model', async () => {
  const response = await handleReviewRouterRequest(new Request(`${base}/models`, {
    headers: { Authorization: `Bearer ${routerToken}` },
  }), auth);
  assert.equal(response?.status, 200);
  const payload = (await response?.json()) as { data?: Array<{ id?: string }> };
  assert.deepEqual(payload.data?.map((model) => model.id), [
    'kanarek-review-free',
    'kanarek-quip-free',
    'kanarek-code-review-free',
    'kanarek-judge-free',
    'kanarek-shitpost-free',
    'kanarek-review',
    'kanarek-review-paid',
    'kanarek-work-paid',
  ]);
});

test('review router prefers OpenRouter before the paid review reserves', async () => {
  let call: { url?: string; model?: unknown; authorization?: string | null } = {};
  const env = {
    ...auth, GEMINI_API_KEY: 'gemini-key', OPENROUTER_API_KEY: 'openrouter-key',
  };
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review',
    stream: true,
    messages: [{ role: 'user', content: 'review' }],
  }), env, ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: unknown };
    call = {
      url: String(input),
      model: body.model,
      authorization: new Headers(init?.headers).get('authorization'),
    };
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter');
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.model, REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_OPENROUTER_MODELS[0]);
  assert.equal(call.authorization, 'Bearer openrouter-key');
});

test('heterogeneous OpenRouter fallback chains avoid optional reasoning without shrinking caller output', async () => {
  let body: Record<string, unknown> = {};
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 36_864,
    messages: [{ role: 'user', content: 'review carefully' }],
  }), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(body.model, REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_OPENROUTER_MODELS[0]);
  assert.deepEqual(body.models, REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_OPENROUTER_MODELS.slice(1));
  assert.equal(body.reasoning, undefined);
  assert.equal(body.max_tokens, 36_864);
});

test('OpenRouter primary retry keeps high reasoning after a fallback-chain 400', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 36_864,
    messages: [{ role: 'user', content: 'review carefully' }],
  }), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    if (bodies.length === 1) {
      return Promise.resolve(Response.json({
        error: { message: 'models list invalid' },
      }, { status: 400 }));
    }
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0]?.max_tokens, 36_864);
  assert.equal(bodies[0]?.reasoning, undefined);
  assert.deepEqual(bodies[1]?.reasoning, { effort: 'high' });
  assert.equal(bodies[1]?.max_tokens, 36_864);
  assert.equal(bodies[1]?.models, undefined);
});

test('provider context fitting shrinks Groq output headroom before a 413 and skips impossible requests', () => {
  const fits = fitProviderAttemptTokenBudget({
    max_tokens: 36_864,
    messages: [{ role: 'user', content: 'x'.repeat(100_000) }],
  }, {
    minimumMaxTokens: 16_384,
    maximumMaxTokens: 65_536,
    maximumContextTokens: 131_072,
  });
  assert.ok(fits);
  assert.ok((fits.max_tokens as number) >= 16_384);
  assert.ok((fits.max_tokens as number) < 36_864);

  const impossible = fitProviderAttemptTokenBudget({
    max_tokens: 36_864,
    messages: [{ role: 'user', content: 'x'.repeat(120_000) }],
  }, {
    minimumMaxTokens: 16_384,
    maximumMaxTokens: 65_536,
    maximumContextTokens: 131_072,
  });
  assert.equal(impossible, null);
});

test('provider context fitting counts tool schemas as Groq prompt context', () => {
  const impossible = fitProviderAttemptTokenBudget({
    max_tokens: 16_384,
    messages: [{ role: 'user', content: 'review carefully' }],
    tools: [{
      type: 'function',
      function: {
        name: 'huge_schema',
        description: 'x'.repeat(120_000),
        parameters: { type: 'object', properties: {} },
      },
    }],
  }, {
    minimumMaxTokens: 16_384,
    maximumMaxTokens: 65_536,
    maximumContextTokens: 131_072,
  });
  assert.equal(impossible, null);
});

test('review router uses direct DeepSeek Flash before Gemini Flex as the first paid reserve', async () => {
  const calls: Array<{
    url: string;
    model: unknown;
    thinking: unknown;
    reasoningEffort: unknown;
    responseFormat: unknown;
    authorization: string | null;
  }> = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review',
    stream: false,
    max_tokens: 16_384,
    messages: [{ role: 'user', content: 'review' }],
  }), {
    ...auth,
    DEEPSEEK_API_KEY: 'deepseek-key',
    GEMINI_API_KEY: 'gemini-key',
  }, ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({
      url: String(input),
      model: body.model,
      thinking: body.thinking,
      reasoningEffort: body.reasoning_effort,
      responseFormat: body.response_format,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    return Promise.resolve(new Response('{"choices":[],"model":"deepseek-flash"}', { status: 200 }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'deepseek');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(calls[0]?.model, 'deepseek-flash');
  assert.deepEqual(calls[0]?.thinking, { type: 'enabled' });
  assert.equal(calls[0]?.reasoningEffort, 'max');
  assert.deepEqual(calls[0]?.responseFormat, { type: 'json_object' });
  assert.equal(calls[0]?.authorization, 'Bearer deepseek-key');
});

test('paid work contract uses DeepSeek max reasoning without JSON mode', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-work-paid',
    stream: false,
    messages: [{ role: 'user', content: 'edit repository' }],
    tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }],
  }), {
    ...auth,
    DEEPSEEK_API_KEY: 'test-value',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'done' } }],
      model: 'deepseek-flash',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'deepseek');
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.model, 'deepseek-flash');
  assert.equal(bodies[0]?.reasoning_effort, 'max');
  assert.equal(bodies[0]?.max_tokens, 131_072);
  assert.equal('response_format' in (bodies[0] ?? {}), false);
  assert.ok(Array.isArray(bodies[0]?.tools));
});

test('paid review contract skips the free pool and gives DeepSeek the heavy reasoning budget', async () => {
  const calls: Array<{ url: string; maxTokens: unknown; reasoningEffort: unknown }> = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-paid',
    stream: false,
    max_tokens: 16_384,
    messages: [{ role: 'user', content: 'expanded paid review' }],
  }), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    DEEPSEEK_API_KEY: 'deepseek-key',
  }, ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({
      url: String(input),
      maxTokens: body.max_tokens,
      reasoningEffort: body.reasoning_effort,
    });
    return Promise.resolve(new Response('{"choices":[],"model":"deepseek-flash"}', { status: 200 }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'deepseek');
  assert.deepEqual(calls, [{
    url: 'https://api.deepseek.com/chat/completions',
    maxTokens: 131_072,
    reasoningEffort: 'max',
  }]);
});

test('paid review contract falls through from DeepSeek to native Gemini Interactions', async () => {
  const urls: string[] = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-paid',
    stream: false,
    messages: [{ role: 'user', content: 'expanded paid review' }],
  }), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    DEEPSEEK_API_KEY: 'deepseek-key',
    GEMINI_API_KEY: 'gemini-key',
  }, ((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (new URL(url).hostname === 'api.deepseek.com') {
      return Promise.resolve(new Response('insufficient balance', { status: 402 }));
    }
    return Promise.resolve(Response.json({
      id: 'int_review',
      model: 'gemini-3.8-flash',
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'native worked' }] }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'gemini-flex');
  const payload = (await response?.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  assert.equal(payload.choices?.[0]?.message?.content, 'native worked');
  assert.deepEqual(urls, [
    'https://api.deepseek.com/chat/completions',
    'https://generativelanguage.googleapis.com/v1/interactions',
  ]);
});

test('DeepSeek balance exhaustion falls through to native Gemini Flex', async () => {
  const urls: string[] = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review',
    stream: false,
    messages: [{ role: 'user', content: 'review' }],
  }), {
    ...auth,
    DEEPSEEK_API_KEY: 'deepseek-key',
    GEMINI_API_KEY: 'gemini-key',
  }, ((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (new URL(url).hostname === 'api.deepseek.com') {
      return Promise.resolve(new Response('insufficient balance', { status: 402 }));
    }
    return Promise.resolve(Response.json({
      id: 'int_review',
      model: 'gemini-3.8-flash',
      status: 'completed',
      steps: [{ type: 'model_output', content: [{ type: 'text', text: 'ok' }] }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'gemini-flex');
  assert.deepEqual(urls, [
    'https://api.deepseek.com/chat/completions',
    'https://generativelanguage.googleapis.com/v1/interactions',
  ]);
});

test('Gemini Flex uses the native v1 Interactions contract with high thinking', async () => {
  let call: {
    url?: string;
    body?: Record<string, unknown>;
    authorization?: string | null;
    apiKey?: string | null;
  } = {};
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-paid',
    stream: false,
    max_tokens: 512,
    temperature: 0.3,
    top_p: 0.8,
    top_k: 20,
    thinking_budget: 8192,
    candidate_count: 2,
    messages: [
      { role: 'system', content: 'Return a concise review.' },
      { role: 'user', content: 'review' },
    ],
  }), {
    ...auth, GEMINI_API_KEY: 'gemini-key',
  }, ((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    call = {
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      authorization: headers.get('authorization'),
      apiKey: headers.get('x-goog-api-key'),
    };
    return Promise.resolve(Response.json({
      id: 'int_native',
      model: 'gemini-3.8-flash',
      status: 'completed',
      steps: [{
        type: 'model_output',
        content: [{ type: 'text', text: '{"findings":[]}' }],
      }],
      usage: {
        total_input_tokens: 20,
        total_output_tokens: 5,
        total_thought_tokens: 8,
        total_tokens: 33,
      },
    }, {
      headers: {
        'content-length': '999',
        'content-encoding': 'gzip',
        'x-goog-request-id': 'google-request-1',
      },
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'gemini-flex');
  assert.equal(response?.headers.get('content-length'), null);
  assert.equal(response?.headers.get('content-encoding'), null);
  assert.equal(response?.headers.get('x-goog-request-id'), 'google-request-1');
  assert.equal(call.url, 'https://generativelanguage.googleapis.com/v1/interactions');
  assert.equal(call.authorization, null);
  assert.equal(call.apiKey, 'gemini-key');

  const body = call.body ?? {};
  assert.equal(body.model, 'gemini-3.8-flash');
  assert.equal(body.service_tier, 'flex');
  assert.equal(body.system_instruction, 'Return a concise review.');
  assert.equal(body.stream, false);
  assert.equal(body.store, false);
  assert.deepEqual(body.input, [
    { type: 'user_input', content: [{ type: 'text', text: 'review' }] },
  ]);
  assert.deepEqual(body.generation_config, {
    max_output_tokens: 16_384,
    thinking_level: 'high',
  });
  for (const deprecated of [
    'temperature', 'top_p', 'top_k', 'thinking_budget', 'candidate_count', 'reasoning_effort',
  ]) {
    assert.equal(deprecated in body, false);
  }

  const payload = (await response?.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
    };
  };
  assert.equal(payload.model, 'gemini-3.8-flash');
  assert.equal(payload.choices?.[0]?.message?.content, '{"findings":[]}');
  assert.deepEqual(payload.usage, {
    prompt_tokens: 20,
    completion_tokens: 5,
    total_tokens: 33,
    completion_tokens_details: { reasoning_tokens: 8 },
  });
});

test('Gemini Interactions bridges OpenAI tool history and function calls for paid work', async () => {
  let body: Record<string, unknown> = {};
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-work-paid',
    stream: false,
    messages: [
      { role: 'system', content: 'Work on the repository.' },
      { role: 'user', content: 'Read README.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{
          id: 'call_1',
          type: 'function',
          function: { name: 'read_file', arguments: '{"path":"README.md"}' },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'read_file',
        content: '{"content":"hello"}',
      },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
    }],
    tool_choice: 'auto',
  }), {
    ...auth,
    GEMINI_API_KEY: 'gemini-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(Response.json({
      id: 'int_work',
      model: 'gemini-3.8-flash',
      status: 'requires_action',
      steps: [{
        type: 'function_call',
        id: 'call_2',
        name: 'read_file',
        arguments: { path: 'package.json' },
      }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'gemini-flex');
  assert.deepEqual(body.tools, [{
    type: 'function',
    name: 'read_file',
    description: 'Read a file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  }]);
  assert.deepEqual(body.generation_config, {
    max_output_tokens: 16_384,
    thinking_level: 'high',
    tool_choice: 'auto',
  });
  assert.deepEqual(body.input, [
    { type: 'user_input', content: [{ type: 'text', text: 'Read README.' }] },
    { type: 'function_call', id: 'call_1', name: 'read_file', arguments: { path: 'README.md' } },
    {
      type: 'function_result',
      call_id: 'call_1',
      name: 'read_file',
      result: [{ type: 'text', text: '{"content":"hello"}' }],
    },
  ]);

  const payload = (await response?.json()) as {
    choices?: Array<{
      finish_reason?: string;
      message?: {
        content?: string | null;
        tool_calls?: Array<{
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
    }>;
  };
  const choice = payload.choices?.[0];
  assert.equal(choice?.finish_reason, 'tool_calls');
  assert.equal(choice?.message?.content, null);
  assert.deepEqual(choice?.message?.tool_calls, [{
    id: 'call_2',
    type: 'function',
    function: { name: 'read_file', arguments: '{"path":"package.json"}' },
  }]);
});

test('Gemini stateless tool turns preserve thought signatures exactly', async () => {
  const thought = {
    type: 'thought',
    signature: 'signed-reasoning-context',
    summary: [{ type: 'text', text: 'Need to inspect another file.' }],
  };
  const functionCall = {
    type: 'function_call',
    id: 'call_1',
    name: 'read_file',
    arguments: { path: 'README.md' },
  };
  let firstBody: Record<string, unknown> = {};
  const first = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-work-paid',
    stream: false,
    messages: [
      { role: 'developer', content: 'Work carefully.' },
      { role: 'user', content: 'Inspect the repository.' },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'read_file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    }],
    tool_choice: {
      type: 'function',
      function: { name: 'read_file' },
    },
  }), {
    ...auth,
    GEMINI_API_KEY: 'gemini-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    firstBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(Response.json({
      id: 'int_tool_1',
      model: 'gemini-3.8-flash',
      status: 'requires_action',
      steps: [thought, functionCall],
    }));
  }) as typeof fetch);

  assert.equal(first?.status, 200);
  assert.equal(firstBody.system_instruction, 'Work carefully.');
  assert.deepEqual(
    (firstBody.generation_config as Record<string, unknown>).tool_choice,
    { allowed_tools: { mode: 'any', tools: ['read_file'] } },
  );

  const firstPayload = (await first?.json()) as {
    choices?: Array<{ message?: Record<string, unknown> }>;
  };
  const assistant = firstPayload.choices?.[0]?.message;
  assert.ok(assistant);
  assert.deepEqual(
    (assistant.kanarek_provider_state as {
      gemini_interactions?: { steps?: unknown[] };
    }).gemini_interactions?.steps,
    [thought, functionCall],
  );

  let secondBody: Record<string, unknown> = {};
  const second = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-work-paid',
    stream: false,
    messages: [
      { role: 'developer', content: 'Work carefully.' },
      { role: 'user', content: 'Inspect the repository.' },
      assistant,
      {
        role: 'tool',
        tool_call_id: 'call_1',
        name: 'read_file',
        content: '{"content":"hello"}',
      },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'read_file',
        parameters: { type: 'object', properties: { path: { type: 'string' } } },
      },
    }],
    tool_choice: 'auto',
  }), {
    ...auth,
    GEMINI_API_KEY: 'gemini-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    secondBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(Response.json({
      id: 'int_tool_2',
      model: 'gemini-3.8-flash',
      status: 'completed',
      steps: [{
        type: 'model_output',
        content: [{ type: 'text', text: 'done' }],
      }],
    }));
  }) as typeof fetch);

  assert.equal(second?.status, 200);
  assert.deepEqual(secondBody.input, [
    { type: 'user_input', content: [{ type: 'text', text: 'Inspect the repository.' }] },
    thought,
    functionCall,
    {
      type: 'function_result',
      call_id: 'call_1',
      name: 'read_file',
      result: [{ type: 'text', text: '{"content":"hello"}' }],
    },
  ]);
});

test('Gemini provider state is stripped before another paid provider sees the message', async () => {
  let deepSeekMessages: unknown[] = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-work-paid',
    stream: false,
    messages: [{
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: 'call_1',
        type: 'function',
        function: { name: 'read_file', arguments: '{"path":"README.md"}' },
      }],
      kanarek_provider_state: {
        gemini_interactions: {
          steps: [{ type: 'thought', signature: 'secret-provider-state' }],
        },
      },
    }],
  }), {
    ...auth,
    DEEPSEEK_API_KEY: 'deepseek-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages?: unknown[] };
    deepSeekMessages = body.messages ?? [];
    return Promise.resolve(Response.json({
      model: 'deepseek-v3.2-speciale',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'deepseek');
  const message = deepSeekMessages[0] as Record<string, unknown>;
  assert.equal('kanarek_provider_state' in message, false);
});

test('Gemini Flex 503 keeps transient semantics and falls through to DeepSeek', async () => {
  const calls: string[] = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-paid',
    stream: false,
    messages: [{ role: 'user', content: 'review' }],
  }), {
    ...auth,
    KANAREK_REVIEW_PAID_PROVIDER_ORDER: 'gemini-flex,deepseek',
    GEMINI_API_KEY: 'gemini-key',
    DEEPSEEK_API_KEY: 'deepseek-key',
  }, ((input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (new URL(url).hostname === 'generativelanguage.googleapis.com') {
      return Promise.resolve(new Response('flex capacity unavailable', { status: 503 }));
    }
    return Promise.resolve(Response.json({
      model: 'deepseek-v3.2-speciale',
      choices: [{ message: { role: 'assistant', content: '{"findings":[]}' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'deepseek');
  assert.deepEqual(calls, [
    'https://generativelanguage.googleapis.com/v1/interactions',
    'https://api.deepseek.com/chat/completions',
  ]);
});

test('Gemini spend-cap 403 is classified without exposing the provider body', async () => {
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-paid',
    stream: false,
    messages: [{ role: 'user', content: 'review' }],
  }), {
    ...auth,
    GEMINI_API_KEY: 'gemini-key',
  }, (() => Promise.resolve(Response.json({
    error: {
      code: 403,
      message: 'Gemini API requests are blocked because the project spend cap has been reached.',
      status: 'PERMISSION_DENIED',
    },
  }, { status: 403 }))) as typeof fetch);

  assert.equal(response?.status, 429);
  const payload = (await response?.json()) as { error?: { message?: string } };
  assert.match(payload.error?.message ?? '', /gemini-flex:http_403_billing_cap/);
  assert.doesNotMatch(payload.error?.message ?? '', /spend cap has been reached/i);
});


test('paid review contract uses the review task profile while work stays separate', () => {
  assert.equal(reviewRouterTaskProfile('kanarek-review-paid'), 'review');
  assert.equal(reviewRouterTaskProfile('kanarek-work-paid'), 'general');
});

test('task timeout policy is patient only where latency is acceptable', () => {
  assert.equal(taskProviderTimeoutMs(10_000, 'general'), 10_000);
  assert.equal(taskProviderTimeoutMs(10_000, 'quip'), 10_000);
  assert.equal(taskProviderTimeoutMs(10_000, 'review'), 60_000);
  assert.equal(taskProviderTimeoutMs(30_000, 'judge'), 60_000);
  assert.equal(taskProviderTimeoutMs(10_000, 'shitpost'), 120_000);
  assert.equal(taskProviderTimeoutMs(180_000, 'shitpost'), 180_000);
});

test('free router contract never spends DeepSeek or Gemini paid reserves', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    messages: [{ role: 'user', content: 'quip' }],
  }), {
    ...auth, DEEPSEEK_API_KEY: 'deepseek-key', GEMINI_API_KEY: 'gemini-key',
  }, (() => {
    calls += 1;
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 503);
  assert.equal(calls, 0);
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
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);
  assert.equal(response?.status, 200);
  const assistant = messages[1] as Record<string, unknown>;
  assert.equal('refusal' in assistant, false);
  assert.deepEqual(assistant.tool_calls, toolCalls);
  assert.deepEqual(messages[2], { role: 'tool', tool_call_id: 'call_1', content: 'diff' });
});

test('code-review profile gives Groq GPT-OSS its configured reasoning effort', async () => {
  let body: Record<string, unknown> = {};
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 2_048,
    messages: [{ role: 'user', content: 'review this change' }],
  }), {
    ...auth,
    GROQ_API_KEY: 'groq-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(Response.json({
      model: 'openai/gpt-oss-120b',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'groq');
  assert.equal(body.model, 'openai/gpt-oss-120b');
  assert.equal(body.reasoning_effort, 'high');
  assert.equal(body.max_tokens, 16_384);
});

test('code-review profile allows Groq reasoning effort tuning without code changes', async () => {
  let effort: unknown;
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    messages: [{ role: 'user', content: 'compact task' }],
  }), {
    ...auth,
    GROQ_API_KEY: 'groq-key',
    KANAREK_REVIEW_GROQ_REASONING_EFFORT: 'low',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    effort = body.reasoning_effort;
    return Promise.resolve(Response.json({
      model: 'openai/gpt-oss-120b',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(effort, 'low');
});

test('Groq GPT-OSS 20B shares the context admission profile', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 36_864,
    messages: [{ role: 'user', content: 'x'.repeat(100_000) }],
  }), {
    ...auth,
    GROQ_API_KEY: 'groq-key',
    KANAREK_REVIEW_GROQ_MODEL: 'openai/gpt-oss-20b',
    KANAREK_REVIEW_PROVIDER_ORDER: 'groq',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Promise.resolve(Response.json({
      model: 'openai/gpt-oss-20b',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(bodies.length, 1);
  assert.ok((bodies[0]?.max_tokens as number) >= 16_384);
  assert.ok((bodies[0]?.max_tokens as number) < 36_864);
});

test('Groq context limits are applied only to the matching GPT-OSS model', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 36_864,
    messages: [{ role: 'user', content: 'x'.repeat(120_000) }],
  }), {
    ...auth,
    GROQ_API_KEY: 'groq-key',
    KANAREK_REVIEW_GROQ_MODEL: 'llama-3.3-70b-versatile',
    KANAREK_REVIEW_PROVIDER_ORDER: 'groq',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Promise.resolve(Response.json({
      model: 'llama-3.3-70b-versatile',
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0]?.max_tokens, 36_864);
});

test('legacy free alias leaves Groq reasoning at the provider default', async () => {
  let body: Record<string, unknown> = {};
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    messages: [{ role: 'user', content: 'legacy shared call' }],
  }), {
    ...auth,
    GROQ_API_KEY: 'groq-key',
    KANAREK_REVIEW_GROQ_REASONING_EFFORT: 'high',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal('reasoning_effort' in body, false);
});

test('code-review profile bounds invalid Groq reasoning configuration', async () => {
  let effort: unknown;
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    messages: [{ role: 'user', content: 'review' }],
  }), {
    ...auth,
    GROQ_API_KEY: 'groq-key',
    KANAREK_REVIEW_GROQ_REASONING_EFFORT: 'turbo-mega',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    effort = body.reasoning_effort;
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(effort, 'high');
});

test('quip profile lowers Groq reasoning and omits it for unsupported models', async () => {
  const observed: Array<{ effort: unknown; model: unknown }> = [];
  for (const [model, expectedEffort] of [
    ['openai/gpt-oss-120b', 'low'],
    ['llama-3.3-70b-versatile', undefined],
  ] as const) {
    const response = await handleReviewRouterRequest(request(routerToken, {
      model: 'kanarek-quip-free',
      stream: false,
      messages: [{ role: 'user', content: 'one short quip' }],
    }), {
      ...auth,
      GROQ_API_KEY: 'groq-key',
      KANAREK_REVIEW_GROQ_MODEL: model,
    }, ((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      observed.push({ effort: body.reasoning_effort, model: body.model });
      return Promise.resolve(Response.json({
        model,
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }));
    }) as typeof fetch);
    assert.equal(response?.status, 200);
    assert.equal(observed.at(-1)?.effort, expectedEffort);
  }
  assert.deepEqual(observed.map(({ model }) => model), [
    'openai/gpt-oss-120b',
    'llama-3.3-70b-versatile',
  ]);
});

test('shitpost profile gives supported Groq models high reasoning with enough headroom', async () => {
  let effort: unknown;
  let maxTokens: unknown;
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-shitpost-free',
    stream: false,
    max_tokens: 256,
    messages: [{ role: 'user', content: 'take your time and make one good joke' }],
  }), {
    ...auth,
    GROQ_API_KEY: 'groq-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    effort = body.reasoning_effort;
    maxTokens = body.max_tokens;
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(effort, 'high');
  assert.equal(maxTokens, 16_384);
});

test('AIHubMix shares one model pool but orders it by task', async () => {
  const models: string[] = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    messages: [{ role: 'user', content: 'review this diff' }],
  }), {
    ...auth,
    AIHUBMIX_API_KEY: 'aihubmix-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    models.push(body.model ?? '');
    if (models.length === 1) return Promise.resolve(new Response('busy', { status: 503 }));
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.deepEqual(models, [
    'coding-kimi-k3-free',
    'nemotron-3.5-lightning-free',
  ]);
});

test('provider health exposes budget classes and task queues', async () => {
  const health = await reviewProviderPoolHealth({
    ...auth,
    AIHUBMIX_API_KEY: 'aihubmix-key',
    AI_GATEWAY_API_KEY: 'vercel-key',
  });
  assert.equal(
    health.providers.find((provider) => provider.provider === 'vercel')?.budgetClass,
    'monthly-free-credit',
  );
  assert.equal(health.taskOrders.review[0], 'openrouter');
  assert.equal(health.taskOrders.quip[0], 'aihubmix');
  assert.equal(health.taskOrders.shitpost[1], 'vercel');
});

test('review router uses the OrcaRouter auto resolver', async () => {
  const calls: Array<{ url: string; model: unknown; models: unknown; authorization: string | null }> = [];
  const fetcher = ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: unknown; models?: unknown };
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input), model: body.model, models: body.models,
      authorization: headers.get('authorization'),
    });
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch;

  const response = await handleReviewRouterRequest(request(), {
    ...auth, ORCAROUTER_API_KEY: 'orca-key',
  }, fetcher);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.deepEqual(calls.map(({ url, model, models }) => ({ url, model, models })), [
    { url: 'https://api.orcarouter.ai/v1/chat/completions', model: 'orcarouter/auto', models: undefined },
  ]);
  assert.equal(calls.every((call) => call.authorization === 'Bearer orca-key'), true);
});

test('judge-style fake call falls through after OrcaRouter rejects an oversized payload', async () => {
  const calls: Array<{ url: string; model: unknown; maxTokens: unknown }> = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    max_tokens: 1_024,
    messages: [
      { role: 'system', content: 'Judge only the supplied findings.' },
      { role: 'user', content: JSON.stringify({ findings: ['x'.repeat(12_000)] }) },
    ],
  }), {
    ...auth,
    ORCAROUTER_API_KEY: 'orca-key',
    HUGGINGFACE_API_KEY: 'hf-key',
  }, ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body)) as { model?: unknown; max_tokens?: unknown };
    calls.push({ url, model: body.model, maxTokens: body.max_tokens });
    if (url.includes('orcarouter.ai')) {
      return Promise.resolve(new Response('payload too large', { status: 413 }));
    }
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'huggingface-publicai');
  assert.deepEqual(calls.map(({ url }) => url), [
    'https://api.orcarouter.ai/v1/chat/completions',
    'https://router.huggingface.co/v1/chat/completions',
  ]);
  assert.equal(calls[0]?.model, 'orcarouter/auto');
  assert.equal(calls.every(({ maxTokens }) => maxTokens === 1_024), true);
});

test('OrcaRouter context-window rejection falls through without poisoning later compact calls', async () => {
  const env = {
    ...auth,
    ORCAROUTER_API_KEY: 'orca-key',
    HUGGINGFACE_API_KEY: 'hf-key',
    KANAREK_REVIEW_COOLDOWNS: cooldownNamespace(),
  };
  const firstUrls: string[] = [];
  const first = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    max_tokens: 1_024,
    messages: [{ role: 'user', content: 'x'.repeat(20_000) }],
  }), env, ((input: RequestInfo | URL) => {
    const url = String(input);
    firstUrls.push(url);
    if (url.includes('orcarouter.ai')) {
      return Promise.resolve(Response.json(
        { error: { message: 'context length exceeded: too many tokens' } },
        { status: 400 },
      ));
    }
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(first?.status, 200);
  assert.deepEqual(firstUrls, [
    'https://api.orcarouter.ai/v1/chat/completions',
    'https://router.huggingface.co/v1/chat/completions',
  ]);

  const secondUrls: string[] = [];
  const second = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    max_tokens: 512,
    messages: [{ role: 'user', content: 'compact judge request' }],
  }), env, ((input: RequestInfo | URL) => {
    secondUrls.push(String(input));
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(second?.status, 200);
  assert.equal(second?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.deepEqual(secondUrls, ['https://api.orcarouter.ai/v1/chat/completions']);
});

test('OrcaRouter judge quota is cooled down and the fake judge falls through', async () => {
  const env = {
    ...auth,
    ORCAROUTER_API_KEY: 'orca-key',
    HUGGINGFACE_API_KEY: 'hf-key',
    KANAREK_REVIEW_COOLDOWNS: cooldownNamespace(),
  };
  const firstUrls: string[] = [];
  const first = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    max_tokens: 512,
    messages: [{ role: 'user', content: 'judge these findings' }],
  }), env, ((input: RequestInfo | URL) => {
    const url = String(input);
    firstUrls.push(url);
    if (url.includes('orcarouter.ai')) return Promise.resolve(new Response('quota', { status: 429 }));
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(first?.status, 200);
  assert.deepEqual(firstUrls, [
    'https://api.orcarouter.ai/v1/chat/completions',
    'https://router.huggingface.co/v1/chat/completions',
  ]);

  const retryUrls: string[] = [];
  const retry = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    max_tokens: 512,
    messages: [{ role: 'user', content: 'judge these findings again' }],
  }), env, ((input: RequestInfo | URL) => {
    retryUrls.push(String(input));
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(retry?.status, 200);
  assert.equal(retry?.headers.get('x-kanarek-review-provider'), 'huggingface-publicai');
  assert.deepEqual(retryUrls, ['https://router.huggingface.co/v1/chat/completions']);
});

test('OrcaRouter auto keeps generic free-router calls provider-only', async () => {
  const messages = [
    { role: 'system', content: 'Write one short quip. No code review.' },
    { role: 'user', content: '{"status":"ready"}' },
  ];
  let upstreamBody: Record<string, unknown> = {};
  const upstreamPayload = {
    id: 'fake-quip',
    model: 'deepseek/deepseek-v4-flash-free',
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Fake quip from the shared free router.' },
    }],
  };

  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    max_tokens: 256,
    messages,
  }), {
    ...auth,
    ORCAROUTER_API_KEY: 'orca-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(Response.json(upstreamPayload));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.equal(upstreamBody.model, 'orcarouter/auto');
  assert.deepEqual(upstreamBody.messages, messages);
  assert.equal(upstreamBody.max_tokens, 256);
  assert.deepEqual(await response?.json(), upstreamPayload);
});

test('OrcaRouter auto passes a fake PR-review payload without owning review semantics', async () => {
  const messages = [
    { role: 'system', content: 'Return the caller-defined review JSON contract.' },
    { role: 'user', content: 'Fake diff: + return unsafe(input)' },
  ];
  let upstreamBody: Record<string, unknown> = {};
  const reviewJson = JSON.stringify({
    summary: '发现一个问题。',
    findings: [{
      severity: 'high',
      path: 'src/demo.ts',
      line: 7,
      title: '输入未经校验',
      body: '普通调用路径会接受未校验输入。',
    }],
  });
  const upstreamPayload = {
    id: 'fake-review',
    model: 'deepseek/deepseek-v4-flash-free',
    choices: [{
      finish_reason: 'stop',
      message: { role: 'assistant', content: reviewJson },
    }],
  };

  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review',
    stream: false,
    max_tokens: 4_096,
    messages,
  }), {
    ...auth,
    ORCAROUTER_API_KEY: 'orca-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    upstreamBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(Response.json(upstreamPayload));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.equal(upstreamBody.model, 'orcarouter/auto');
  assert.deepEqual(upstreamBody.messages, messages);
  assert.equal(upstreamBody.max_tokens, 4_096);
  assert.deepEqual(await response?.json(), upstreamPayload);
});

test('review router honors the shared configured OpenRouter model chain', async () => {
  let body: { model?: unknown; models?: unknown } = {};
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    KANAREK_OPENROUTER_MODELS: 'first/free, second/free,first/free',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as { model?: unknown; models?: unknown };
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
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
    if (firstUrls.length <= 1) return Promise.resolve(new Response('quota', { status: 429 }));
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);
  assert.equal(first?.status, 200);
  assert.deepEqual(firstUrls, [
    'https://openrouter.ai/api/v1/chat/completions',
    'https://api.orcarouter.ai/v1/chat/completions',
  ]);

  const retryUrls: string[] = [];
  const retry = await handleReviewRouterRequest(request(), env, ((input: RequestInfo | URL) => {
    retryUrls.push(String(input));
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
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
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
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

test('free probe timeout defaults to 10s and stays below the normal router ceiling', () => {
  assert.equal(reviewFreeProbeTimeoutMs(undefined), 10_000);
  assert.equal(reviewFreeProbeTimeoutMs('5000'), 5_000);
  assert.equal(reviewFreeProbeTimeoutMs('30000'), 30_000);
  assert.equal(reviewFreeProbeTimeoutMs('999'), 10_000);
  assert.equal(reviewFreeProbeTimeoutMs('30001'), 10_000);
  assert.equal(reviewFreeProbeTimeoutMs('wat'), 10_000);
  assert.equal(reviewFreeProbeTimeoutMs(undefined, 1_000), 1_000);
  assert.equal(reviewFreeProbeTimeoutMs('5000', 2_000), 2_000);
});

test('review router prefers HTTP free providers before guarded Workers AI', async () => {
  let aiCalls = 0;
  const AI = workersAiBinding(async (model) => {
    aiCalls += 1;
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
  }, (() => {
    httpCalls += 1;
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter');
  assert.equal(httpCalls, 1);
  assert.equal(aiCalls, 0);
});

test('review router falls back to guarded Workers AI after HTTP free providers fail', async () => {
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
  }, (() => {
    httpCalls += 1;
    return Promise.resolve(new Response('quota', { status: 429 }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'workers-ai');
  assert.equal(httpCalls, 1);
  assert.equal(aiModel, '@cf/zai-org/glm-4.7-flash');
  assert.equal(aiInput.stream, false);
  assert.equal('model' in aiInput, false);
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
    { available: true, budgetClass: 'daily-neurons', configured: true, provider: 'workers-ai' },
  );
});


test('review router settles successful Workers AI reservations to reported usage', async () => {
  const namespace = cooldownNamespace();
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    AI: workersAiBinding(async (model) => ({
      id: 'cf-review',
      object: 'chat.completion',
      created: 1,
      model,
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    })),
    KANAREK_REVIEW_COOLDOWNS: namespace,
  });

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'workers-ai');
  const day = new Date().toISOString().slice(0, 10);
  const stub = namespace.get(namespace.idFromName('workers-ai'));
  const budget = await stub.fetch(
    `https://review-cooldown.internal/neuron-budget?day=${day}&limit=10000`,
  );
  const payload = (await budget.json()) as { reserved?: number; remaining?: number };
  assert.equal(payload.reserved, 3);
  assert.equal(payload.remaining, 9_997);
});

test('Workers AI neuron settlement is idempotent', async () => {
  const namespace = cooldownNamespace();
  const stub = namespace.get(namespace.idFromName('workers-ai'));
  const day = '2026-09-08';
  const reservationId = 'settlement-idempotency';
  const reserved = await stub.fetch('https://review-cooldown.internal/reserve-neurons', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ day, neurons: 100, limit: 10_000, reservationId }),
  });
  assert.equal(reserved.status, 200);

  const settle = () => stub.fetch('https://review-cooldown.internal/settle-neurons', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ day, reservationId, actualNeurons: 7 }),
  });
  const first = await settle();
  const second = await settle();
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(((await second.json()) as { missing?: boolean }).missing, true);

  const budget = await stub.fetch(
    `https://review-cooldown.internal/neuron-budget?day=${day}&limit=10000`,
  );
  const payload = (await budget.json()) as { reserved?: number };
  assert.equal(payload.reserved, 7);
});

test('review provider state uses the full Workers AI free daily allocation', async () => {
  const namespace = cooldownNamespace();
  const stub = namespace.get(namespace.idFromName('workers-ai'));
  let reservation = 0;
  const reserve = (neurons: number) => stub.fetch('https://review-cooldown.internal/reserve-neurons', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      day: '2026-09-07',
      neurons,
      limit: 10_000,
      reservationId: `allocation-${++reservation}`,
    }),
  });

  assert.equal((await reserve(6_000)).status, 200);
  const rejected = await reserve(5_000);
  assert.equal(rejected.status, 429);
  const payload = (await rejected.json()) as { allowed?: boolean; reserved?: number };
  assert.equal(payload.allowed, false);
  assert.equal(payload.reserved, 6_000);
  assert.equal((await reserve(4_000)).status, 200);
});

test('review router falls through provider authentication errors', async () => {
  const urls: string[] = [];
  const response = await handleReviewRouterRequest(request(), {
    ...auth, OPENROUTER_API_KEY: 'bad-openrouter-key', ORCAROUTER_API_KEY: 'orca-key',
  }, ((input: RequestInfo | URL) => {
    urls.push(String(input));
    if (urls.length === 1) return Promise.resolve(new Response('forbidden', { status: 403 }));
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
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
    if (bodies.length === 1) return Promise.resolve(new Response('models list invalid', { status: 400 }));
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter');
  assert.equal(bodies.length, 2);
  assert.ok(Array.isArray(bodies[0].models));
  assert.equal('models' in bodies[1], false);
});

test('review router reaches an explicit OpenRouter fallback after a dead primary model', async () => {
  const bodies: Array<{ model?: unknown; models?: unknown }> = [];
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    KANAREK_REVIEW_OPENROUTER_MODELS: 'dead/free,live/free',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: unknown; models?: unknown };
    bodies.push(body);
    if (bodies.length === 1) {
      return Promise.resolve(new Response('fallback list rejected', { status: 400 }));
    }
    if (bodies.length === 2) {
      return Promise.resolve(new Response('model not found', { status: 404 }));
    }
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter');
  assert.deepEqual(bodies.map((body) => body.model), ['dead/free', 'dead/free', 'live/free']);
  assert.deepEqual(bodies[0]?.models, ['live/free']);
  assert.equal(bodies[1]?.models, undefined);
  assert.equal(bodies[2]?.models, undefined);
});

test('reasoning-capable OpenRouter fallback preserves high reasoning', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 36_864,
    messages: [{ role: 'user', content: 'review carefully' }],
  }), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    KANAREK_REVIEW_OPENROUTER_MODELS: 'dead/free,qwen/qwen3.8-27b:free',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    if (bodies.length === 1) {
      return Promise.resolve(new Response('models list invalid', { status: 400 }));
    }
    if (bodies.length === 2) {
      return Promise.resolve(new Response('model not found', { status: 404 }));
    }
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(bodies.length, 3);
  assert.equal(bodies[2]?.model, 'qwen/qwen3.8-27b:free');
  assert.deepEqual(bodies[2]?.reasoning, { effort: 'high' });
  assert.equal(bodies[2]?.max_tokens, 36_864);
});

test('review router does not fan out model retries for a request-wide OpenRouter 400', async () => {
  const bodies: Array<{ model?: unknown; models?: unknown }> = [];
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    OLLAMA_API_KEY: 'ollama-key',
  }, ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'openrouter.ai') {
      const body = JSON.parse(String(init?.body)) as { model?: unknown; models?: unknown };
      bodies.push(body);
      return Promise.resolve(new Response('invalid message payload', { status: 400 }));
    }
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'ollama');
  assert.equal(bodies.length, 2);
  assert.ok(Array.isArray(bodies[0]?.models));
  assert.equal(bodies[1]?.models, undefined);
});

test('review router stops model fanout after a primary unsupported-parameter error', async () => {
  const bodies: Array<{ model?: unknown; models?: unknown }> = [];
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    OLLAMA_API_KEY: 'ollama-key',
  }, ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 'openrouter.ai') {
      const body = JSON.parse(String(init?.body)) as { model?: unknown; models?: unknown };
      bodies.push(body);
      if (bodies.length === 1) {
        return Promise.resolve(new Response('models list invalid', { status: 400 }));
      }
      return Promise.resolve(new Response('unsupported parameter response_format', { status: 400 }));
    }
    return Promise.resolve(Response.json({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'ollama');
  assert.equal(bodies.length, 2);
  assert.ok(Array.isArray(bodies[0]?.models));
  assert.equal(bodies[1]?.models, undefined);
});

test('review router falls through after the OpenRouter chain and individual models fail', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(request(), {
    ...auth, OPENROUTER_API_KEY: 'openrouter-key', OLLAMA_API_KEY: 'ollama-key',
  }, ((input: RequestInfo | URL) => {
    calls += 1;
    if (new URL(String(input)).hostname === 'openrouter.ai') {
      return Promise.resolve(new Response('model not found', { status: 400 }));
    }
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'ollama');
  assert.equal(calls, REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_OPENROUTER_MODELS.length + 2);
});

test('review router follows configured free provider order and appends omitted providers', async () => {
  const urls: string[] = [];
  const env = {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    ORCAROUTER_API_KEY: 'orca-key',
    AIHUBMIX_API_KEY: 'aihubmix-key',
    KANAREK_REVIEW_PROVIDER_ORDER: 'orcarouter,openrouter,orcarouter,unknown',
  };
  const response = await handleReviewRouterRequest(request(), env, ((input: RequestInfo | URL) => {
    urls.push(String(input));
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.deepEqual(urls, ['https://api.orcarouter.ai/v1/chat/completions']);

  const health = await reviewProviderPoolHealth(env);
  assert.deepEqual(health.freeOrder, [
    'orcarouter',
    'openrouter',
    'aihubmix',
    'ollama',
    'groq',
    'vercel',
    'huggingface-publicai',
    'workers-ai',
  ]);
});

test('review router reaches OrcaRouter as the last resort after AIHubMix fails', async () => {
  const urls: string[] = [];
  const response = await handleReviewRouterRequest(request(), {
    ...auth, AIHUBMIX_API_KEY: 'aihubmix-key', ORCAROUTER_API_KEY: 'orca-key',
  }, ((input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url === 'https://aihubmix.com/v1/chat/completions') {
      return Promise.resolve(new Response('busy', { status: 503 }));
    }
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.equal(
    urls.filter((url) => url === 'https://aihubmix.com/v1/chat/completions').length,
    REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_AIHUBMIX_MODELS.length,
  );
  assert.equal(urls.at(-1), 'https://api.orcarouter.ai/v1/chat/completions');
});


test('AIHubMix shares one probe deadline across model fallbacks', async () => {
  const urls: string[] = [];
  const startedAt = Date.now();
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    AIHUBMIX_API_KEY: 'aihubmix-key',
    ORCAROUTER_API_KEY: 'orca-key',
    KANAREK_REVIEW_FREE_PROBE_TIMEOUT_MS: '1000',
  }, ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url === 'https://aihubmix.com/v1/chat/completions') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('timed out', 'AbortError'));
        }, { once: true });
      });
    }
    return Promise.resolve(Response.json({
      choices: [{ message: { role: 'assistant', content: 'fallback ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'orcarouter');
  assert.equal(
    urls.filter((url) => url === 'https://aihubmix.com/v1/chat/completions').length,
    1,
  );
  assert.equal(urls.at(-1), 'https://api.orcarouter.ai/v1/chat/completions');
  assert.ok(Date.now() - startedAt < 2_000);
});

test('review router tries Ollama models before Groq', async () => {
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
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'groq');
  assert.deepEqual(calls, [
    { url: 'https://ollama.com/v1/chat/completions', model: 'gpt-oss:120b' },
    { url: 'https://ollama.com/v1/chat/completions', model: 'gpt-oss:20b' },
    { url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-120b' },
  ]);
});

test('review router uses reasoning-enabled Hy3 at Vercel after Groq quota', async () => {
  const calls: Array<{
    url: string;
    model: unknown;
    maxTokens: unknown;
    reasoning: unknown;
    temperature: unknown;
    topP: unknown;
    authorization: string | null;
  }> = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    messages: [{ role: 'user', content: 'review' }],
  }), {
    ...auth,
    GROQ_API_KEY: 'groq-key',
    AI_GATEWAY_API_KEY: 'vercel-key',
  }, ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({
      url: String(input),
      model: body.model,
      maxTokens: body.max_tokens,
      reasoning: body.reasoning,
      temperature: body.temperature,
      topP: body.top_p,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    if (String(input).startsWith('https://api.groq.com/')) {
      return Promise.resolve(new Response('quota', { status: 429 }));
    }
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'vercel');
  assert.deepEqual(calls, [
    {
      url: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'openai/gpt-oss-120b',
      maxTokens: 16_384,
      reasoning: undefined,
      temperature: undefined,
      topP: undefined,
      authorization: 'Bearer groq-key',
    },
    {
      url: 'https://ai-gateway.vercel.sh/v1/chat/completions',
      model: 'tencent/hy3',
      maxTokens: 16_384,
      reasoning: { effort: 'high' },
      temperature: 0.9,
      topP: 1.0,
      authorization: 'Bearer vercel-key',
    },
  ]);
});

test('Vercel reasoning-capable fallbacks get high reasoning and the shared floor', async () => {
  for (const model of [
    'alibaba/qwen3.8-omni-flash',
    'inclusionai/ling-3.1-flash-free',
    'poolside/laguna-s-2.1-free',
  ]) {
    let body: Record<string, unknown> = {};
    const response = await handleReviewRouterRequest(request(routerToken, {
      model: 'kanarek-code-review-free',
      stream: false,
      max_tokens: 512,
      messages: [{ role: 'user', content: 'review carefully' }],
    }), {
      ...auth,
      AI_GATEWAY_API_KEY: 'vercel-key',
      KANAREK_REVIEW_VERCEL_MODELS: model,
    }, ((_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(Response.json({
        model: body.model,
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
      }));
    }) as typeof fetch);

    assert.equal(response?.status, 200, model);
    assert.equal(body.model, model);
    assert.deepEqual(body.reasoning, { effort: 'high' });
    assert.equal(body.max_tokens, 16_384);
    assert.equal('temperature' in body, false);
    assert.equal('top_p' in body, false);
  }
});

test('Vercel caps non-reasoning Qwen Coder at its 8K output limit', async () => {
  let body: Record<string, unknown> = {};
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 16_384,
    messages: [{ role: 'user', content: 'review carefully' }],
  }), {
    ...auth,
    AI_GATEWAY_API_KEY: 'vercel-key',
    KANAREK_REVIEW_VERCEL_MODELS: 'alibaba/qwen3-coder-30b-a3b',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(body.model, 'alibaba/qwen3-coder-30b-a3b');
  assert.equal(body.max_tokens, 8_192);
  assert.equal('reasoning' in body, false);
});

test('Vercel falls back from Hy3 to Qwen without leaking Hy3-only settings', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 256,
    messages: [{ role: 'user', content: 'short quip' }],
  }), {
    ...auth,
    AI_GATEWAY_API_KEY: 'vercel-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push(body);
    if (body.model === 'tencent/hy3') {
      return Promise.resolve(new Response('temporarily unavailable', { status: 503 }));
    }
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'qwen fallback' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'vercel');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    model: 'tencent/hy3',
    stream: false,
    max_tokens: 16_384,
    messages: [{ role: 'user', content: 'short quip' }],
    reasoning: { effort: 'high' },
    temperature: 0.9,
    top_p: 1.0,
  });
  assert.deepEqual(calls[1], {
    model: 'alibaba/qwen3-coder-30b-a3b',
    stream: false,
    max_tokens: 256,
    messages: [{ role: 'user', content: 'short quip' }],
  });
});

test('Vercel falls back from an unusable Hy3 HTTP 200 response to Qwen', async () => {
  const calls: string[] = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 2_048,
    messages: [{ role: 'user', content: 'reason carefully' }],
  }), {
    ...auth,
    AI_GATEWAY_API_KEY: 'vercel-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    calls.push(body.model ?? '');
    if (body.model === 'tencent/hy3') {
      return Promise.resolve(Response.json({
        model: body.model,
        choices: [{
          finish_reason: 'length',
          message: { role: 'assistant', content: '', reasoning: 'used the whole budget thinking' },
        }],
      }));
    }
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'qwen final answer' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'vercel');
  assert.deepEqual(calls, ['tencent/hy3', 'alibaba/qwen3-coder-30b-a3b']);
});

test('Vercel retries only model-specific HTTP 400 failures', async () => {
  const retryCalls: string[] = [];
  const retryResponse = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    messages: [{ role: 'user', content: 'request' }],
  }), {
    ...auth,
    AI_GATEWAY_API_KEY: 'vercel-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    retryCalls.push(body.model ?? '');
    if (body.model === 'tencent/hy3') {
      return Promise.resolve(new Response(
        '{"error":{"message":"Unsupported parameter reasoning"}}',
        { status: 400 },
      ));
    }
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'fallback' } }],
    }));
  }) as typeof fetch);

  assert.equal(retryResponse?.status, 200);
  assert.deepEqual(retryCalls, ['tencent/hy3', 'alibaba/qwen3-coder-30b-a3b']);

  const invalidCalls: string[] = [];
  const invalidResponse = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    messages: [{ role: 'user', content: 'request' }],
  }), {
    ...auth,
    AI_GATEWAY_API_KEY: 'vercel-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    invalidCalls.push(body.model ?? '');
    return Promise.resolve(new Response(
      '{"error":{"message":"message is required"}}',
      { status: 400 },
    ));
  }) as typeof fetch);

  assert.equal(invalidResponse?.status, 400);
  assert.deepEqual(invalidCalls, ['tencent/hy3']);
});

test('Vercel falls back to Qwen after a Hy3 network failure', async () => {
  const calls: string[] = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 512,
    messages: [{ role: 'user', content: 'request' }],
  }), {
    ...auth,
    AI_GATEWAY_API_KEY: 'vercel-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    calls.push(body.model ?? '');
    if (body.model === 'tencent/hy3') {
      return Promise.reject(new Error('network down'));
    }
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'qwen recovered' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'vercel');
  assert.deepEqual(calls, ['tencent/hy3', 'alibaba/qwen3-coder-30b-a3b']);
});

test('Vercel timeout exhausts the shared provider deadline instead of resetting for fallback models', async () => {
  const calls: string[] = [];
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-review-free',
    stream: false,
    max_tokens: 512,
    messages: [{ role: 'user', content: 'request' }],
  }), {
    ...auth,
    AI_GATEWAY_API_KEY: 'vercel-key',
    KANAREK_REVIEW_ROUTER_TIMEOUT_MS: '1000',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: string };
    calls.push(body.model ?? '');
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('timed out', 'AbortError'));
      }, { once: true });
    });
  }) as typeof fetch);

  assert.equal(response?.status, 502);
  assert.deepEqual(calls, ['tencent/hy3']);
});

test('Hy3 preserves the larger of both OpenAI token ceiling fields', async () => {
  let body: Record<string, unknown> = {};
  const response = await handleReviewRouterRequest(request(routerToken, {
    model: 'kanarek-code-review-free',
    stream: false,
    max_tokens: 2_048,
    max_completion_tokens: 16_384,
    messages: [{ role: 'user', content: 'request' }],
  }), {
    ...auth,
    AI_GATEWAY_API_KEY: 'vercel-key',
  }, ((_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(Response.json({
      model: body.model,
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(body.model, 'tencent/hy3');
  assert.equal(body.max_tokens, 16_384);
  assert.equal('max_completion_tokens' in body, false);
});

test('review provider health includes Vercel AI Gateway', async () => {
  const health = await reviewProviderPoolHealth({
    ...auth, AI_GATEWAY_API_KEY: 'vercel-key',
  });
  assert.equal(health.configured, 1);
  assert.equal(health.available, 1);
  assert.equal(health.ready, true);
  assert.deepEqual(
    health.providers.find((provider) => provider.provider === 'vercel'),
    { available: true, budgetClass: 'monthly-free-credit', configured: true, provider: 'vercel' },
  );
});

test('review router uses Hugging Face PublicAI as the final HTTP reserve', async () => {
  const calls: Array<{ url: string; model: unknown; authorization: string | null }> = [];
  const response = await handleReviewRouterRequest(request(), {
    ...auth,
    ORCAROUTER_API_KEY: 'orca-key',
    HUGGINGFACE_API_KEY: 'hf-key',
  }, ((input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model?: unknown };
    calls.push({
      url: String(input),
      model: body.model,
      authorization: new Headers(init?.headers).get('authorization'),
    });
    if (String(input).startsWith('https://api.orcarouter.ai/')) {
      return Promise.resolve(new Response('quota', { status: 429 }));
    }
    return Promise.resolve(Response.json({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'huggingface-publicai');
  assert.deepEqual(calls.slice(-1), [{
    url: 'https://router.huggingface.co/v1/chat/completions',
    model: REVIEW_ROUTER_MODEL_DEFAULTS.KANAREK_REVIEW_HUGGINGFACE_MODEL,
    authorization: 'Bearer hf-key',
  }]);
  assert.equal(calls.filter((call) => call.url.startsWith('https://api.orcarouter.ai/')).length, 1);
});

test('review provider health includes Hugging Face PublicAI', async () => {
  const health = await reviewProviderPoolHealth({
    ...auth, HUGGINGFACE_API_KEY: 'hf-key',
  });
  assert.equal(health.configured, 1);
  assert.equal(health.available, 1);
  assert.equal(health.ready, true);
  assert.deepEqual(
    health.providers.find((provider) => provider.provider === 'huggingface-publicai'),
    { available: true, budgetClass: 'free-quota', configured: true, provider: 'huggingface-publicai' },
  );
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
    'Review providers unavailable (aihubmix:soft_quota, openrouter:http_429, orcarouter:http_503)',
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
    body: JSON.stringify({
      day, neurons: 100, limit: 100, reservationId: 'health-exhaustion',
    }),
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
  });

  assert.equal(response?.status, 502);
  assert.deepEqual(cooldownCategories, ['network']);
});

test('review router skips every provider in a comma-separated exclusion sweep', async () => {
  const calls: string[] = [];
  const response = await handleReviewRouterRequest(new Request(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${routerToken}`,
      'Content-Type': 'application/json',
      [REVIEW_PROVIDER_EXCLUDE_HEADER]: 'openrouter, ORCAROUTER,unknown',
    },
    body: JSON.stringify({
      model: 'kanarek-review-free',
      stream: false,
      messages: [{ role: 'user', content: 'review' }],
    }),
  }), {
    ...auth,
    OPENROUTER_API_KEY: 'openrouter-key',
    ORCAROUTER_API_KEY: 'orca-key',
    GROQ_API_KEY: 'groq-key',
  }, ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(Response.json({
      model: 'groq/model',
      choices: [{ message: { role: 'assistant', content: '{}' } }],
    }));
  }) as typeof fetch);

  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'groq');
  assert.equal(calls.length, 1);
  assert.match(calls[0] ?? '', /groq/);
});
