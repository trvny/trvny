import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decisionModelAttemptTimeoutMs,
  decisionProviderBudgetMs,
  decisionProviderOrder,
  decisionProviderTimeoutMs,
  handleDecisionModelRequest,
} from '../src/decision-model.ts';
import { REVIEW_DECISION_PATH } from '../../kanarek-companion/src/review-service-protocol.ts';

const endpoint = `https://kanarek-review.example${REVIEW_DECISION_PATH}`;
const routerToken = 'router-token';

function request(body: unknown, token = routerToken): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

const env = {
  AIHUBMIX_API_KEY: 'aihubmix-key',
  KANAREK_REVIEW_ROUTER_TOKEN: routerToken,
} as const;

test('decision adapter forwards System One requests and forces the preview model', async () => {
  let url = '';
  let authorization = '';
  let body: Record<string, unknown> = {};
  const response = await handleDecisionModelRequest(
    request({
      state: { review: 'candidate evidence' },
      questions: {
        keep_0: {
          type: 'noul',
          instructions: 'Should it survive?',
        },
        severity: {
          type: 'score',
          instructions: 'How severe?',
          criteria: ['low', 'medium', 'high'],
        },
      },
    }),
    env,
    ((input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(Response.json({
        model: 'decision-model-preview',
        request_id: 'req-1',
        answers: {
          keep_0: { type: 'noul', noul: 0.97 },
          severity: {
            type: 'score',
            score: 1.7,
            confidence: 0.91,
            legend: { 0: 'low', 1: 'medium', 2: 'high' },
            probabilities: { 0: 0.01, 1: 0.28, 2: 0.71 },
          },
        },
        usage: { input_tokens: 123 },
        latency_ms: 41,
      }));
    }) as typeof fetch,
  );

  assert.equal(response?.status, 200);
  assert.equal(url, 'https://aihubmix.com/v1/systemone');
  assert.equal(authorization, 'Bearer aihubmix-key');
  assert.equal(body.model, 'decision-model-preview');
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'aihubmix-decision');
  assert.equal(response?.headers.get('x-kanarek-review-model'), 'decision-model-preview');
});

test('decision adapter rejects unauthenticated callers without touching AIHubMix', async () => {
  let called = false;
  const response = await handleDecisionModelRequest(
    request({
      state: 'x',
      questions: { keep_0: { type: 'noul' } },
    }, 'wrong-token'),
    env,
    (() => {
      called = true;
      return Promise.resolve(Response.json({}));
    }) as typeof fetch,
  );

  assert.equal(response?.status, 401);
  assert.equal(called, false);
});

test('decision adapter bounds the System One question fanout to sixteen', async () => {
  const questions = Object.fromEntries(
    Array.from({ length: 17 }, (_value, index) => [
      `q_${index}`,
      { type: 'noul', instructions: 'yes or no' },
    ]),
  );
  let called = false;
  const response = await handleDecisionModelRequest(
    request({ state: 'x', questions }),
    env,
    (() => {
      called = true;
      return Promise.resolve(Response.json({}));
    }) as typeof fetch,
  );

  assert.equal(response?.status, 400);
  assert.equal(called, false);
});

test('decision adapter fails closed on malformed provider answers', async () => {
  const response = await handleDecisionModelRequest(
    request({
      state: 'x',
      questions: { keep_0: { type: 'noul' } },
    }),
    env,
    (() => Promise.resolve(Response.json({
      model: 'decision-model-preview',
      answers: { keep_0: { type: 'noul', noul: 2 } },
    }))) as typeof fetch,
  );

  assert.equal(response?.status, 502);
});


function activeCooldownNamespace(): DurableObjectNamespace {
  const stub = {
    fetch() {
      return Promise.resolve(Response.json({
        active: true,
        category: 'http_429',
        until: Date.now() + 60_000,
      }));
    },
  } as unknown as DurableObjectStub;
  return {
    idFromName() {
      return {} as DurableObjectId;
    },
    get() {
      return stub;
    },
  } as unknown as DurableObjectNamespace;
}

test('decision adapter uses the L2 sixty-second timeout floor', () => {
  assert.equal(decisionProviderTimeoutMs({
    ...env,
    KANAREK_REVIEW_ROUTER_TIMEOUT_MS: '30000',
  }), 60_000);
});

test('decision adapter honors an active AIHubMix cooldown before fetching', async () => {
  let called = false;
  const response = await handleDecisionModelRequest(
    request({
      state: 'x',
      questions: { keep_0: { type: 'noul' } },
    }),
    {
      ...env,
      KANAREK_REVIEW_COOLDOWNS: activeCooldownNamespace(),
    },
    (() => {
      called = true;
      return Promise.resolve(Response.json({}));
    }) as typeof fetch,
  );

  assert.equal(response?.status, 503);
  assert.equal(called, false);
});


test('decision adapter exposes only a sanitized upstream failure code', async () => {
  const response = await handleDecisionModelRequest(
    request({
      state: 'x',
      questions: { keep_0: { type: 'noul' } },
    }),
    env,
    (() => Promise.resolve(Response.json({
      error: {
        code: 'Invalid Questions / bad shape',
        message: 'provider detail that must not be copied to the diagnostic header',
      },
    }, { status: 400 }))) as typeof fetch,
  );

  assert.equal(response?.status, 502);
  assert.match(
    response?.headers.get('x-kanarek-review-decision-error') ?? '',
    /^pool_exhausted_aihubmix_provider_http_400_invalid_questions/,
  );
  assert.equal(
    response?.headers.get('x-kanarek-review-decision-error')?.includes('provider detail'),
    false,
  );
});


test('decision pool gives the primary most of the shared judge budget', () => {
  assert.equal(decisionProviderBudgetMs(60_000, 2), 40_000);
  assert.equal(decisionProviderBudgetMs(20_000, 1), 10_000);
  assert.equal(decisionProviderBudgetMs(500, 0), 500);
});

test('decision model attempts never outlive the provider or pool deadline', () => {
  assert.equal(decisionModelAttemptTimeoutMs(40_000, 60_000, 1), 35_000);
  assert.equal(decisionModelAttemptTimeoutMs(8_000, 8_000, 0), 8_000);
  assert.equal(decisionModelAttemptTimeoutMs(500, 500, 0), 500);
  assert.equal(decisionModelAttemptTimeoutMs(0, 10_000, 0), 0);
});

test('decision provider rotation is stable for the same review state', () => {
  const input = {
    state: { review: 'same review state' },
    questions: { keep_0: { type: 'noul' } },
  };
  const poolEnv = {
    ...env,
    OPENROUTER_API_KEY: 'openrouter-key',
    QWEN_API_KEY: 'qwen-key',
    KANAREK_REVIEW_DECISION_PROVIDER_ORDER: 'aihubmix,openrouter,qwencloud',
  };

  assert.deepEqual(
    decisionProviderOrder(input, poolEnv),
    decisionProviderOrder(input, poolEnv),
  );
  assert.equal(new Set(decisionProviderOrder(input, poolEnv)).size, 3);
});

test('decision pool can call OpenRouter Mercury Decide directly', async () => {
  let url = '';
  let body: Record<string, unknown> = {};
  let authorization = '';
  const response = await handleDecisionModelRequest(
    request({
      state: { review: 'openrouter decision' },
      questions: { keep_0: { type: 'noul' } },
    }),
    {
      ...env,
      AIHUBMIX_API_KEY: undefined,
      OPENROUTER_API_KEY: 'openrouter-key',
      KANAREK_REVIEW_DECISION_PROVIDER_ORDER: 'openrouter',
    },
    ((input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(Response.json({
        model: 'inception/mercury-decide:free',
        answers: { keep_0: { type: 'noul', noul: 0.96 } },
        usage: { input_tokens: 50 },
      }));
    }) as typeof fetch,
  );

  assert.equal(response?.status, 200);
  assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
  assert.equal(authorization, 'Bearer openrouter-key');
  assert.equal(body.model, 'inception/mercury-decide:free');
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter-decision');
});

test('decision pool can call QwenCloud directly', async () => {
  let url = '';
  let body: Record<string, unknown> = {};
  let authorization = '';
  const response = await handleDecisionModelRequest(
    request({
      state: { review: 'qwencloud decision' },
      questions: { keep_0: { type: 'noul' } },
    }),
    {
      ...env,
      AIHUBMIX_API_KEY: undefined,
      QWEN_API_KEY: 'qwen-key',
      KANAREK_REVIEW_DECISION_PROVIDER_ORDER: 'qwencloud',
    },
    ((input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(Response.json({
        model: 'decision-model-preview',
        answers: { keep_0: { type: 'noul', noul: 0.94 } },
        usage: { input_tokens: 61 },
      }));
    }) as typeof fetch,
  );

  assert.equal(response?.status, 200);
  assert.equal(
    url,
    'https://trial.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/systemone',
  );
  assert.equal(authorization, 'Bearer qwen-key');
  assert.equal(body.model, 'decision-model-preview');
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'qwencloud-decision');
});

test('decision pool falls through a failed primary to the next rotated provider', async () => {
  const input = {
    state: { review: 'fallback rotation example' },
    questions: { keep_0: { type: 'noul' } },
  };
  const poolEnv = {
    ...env,
    OPENROUTER_API_KEY: 'openrouter-key',
    QWEN_API_KEY: undefined,
    KANAREK_REVIEW_DECISION_PROVIDER_ORDER: 'aihubmix,openrouter',
  };
  const order = decisionProviderOrder(input, poolEnv);
  const expected = {
    aihubmix: {
      endpoint: 'https://aihubmix.com/v1/systemone',
      model: 'decision-model-preview',
    },
    openrouter: {
      endpoint: 'https://openrouter.ai/api/alpha/decisions',
      model: 'inception/mercury-decide:free',
    },
  } as const;
  const calls: Array<{ model: string; url: string }> = [];
  const primary = order[0];
  const secondary = order[1];
  assert.ok(primary);
  assert.ok(secondary);

  const response = await handleDecisionModelRequest(
    request(input),
    poolEnv,
    ((requestInfo: RequestInfo | URL, init?: RequestInit) => {
      const url = String(requestInfo);
      const requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const model = String(requestBody.model ?? '');
      calls.push({ model, url });

      if (url === expected[primary].endpoint) {
        return Promise.resolve(Response.json({
          error: { code: 'temporary_failure' },
        }, { status: 503 }));
      }

      assert.equal(url, expected[secondary].endpoint);
      return Promise.resolve(Response.json({
        model,
        answers: { keep_0: { type: 'noul', noul: 0.98 } },
      }));
    }) as typeof fetch,
  );

  assert.equal(response?.status, 200);
  assert.equal(calls[0]?.url, expected[primary].endpoint);
  assert.equal(calls.at(-1)?.url, expected[secondary].endpoint);
  assert.equal(
    calls.filter(({ url }) => url === expected[primary].endpoint).length,
    primary === 'openrouter' ? 2 : 1,
  );
  assert.equal(
    response?.headers.get('x-kanarek-review-provider'),
    `${secondary}-decision`,
  );
});


test('OpenRouter Decisions falls back from Mercury to free Span-01 Lite', async () => {
  const models: string[] = [];
  const response = await handleDecisionModelRequest(
    request({
      state: { review: 'openrouter model fallback' },
      questions: { keep_0: { type: 'noul' } },
    }),
    {
      ...env,
      AIHUBMIX_API_KEY: undefined,
      OPENROUTER_API_KEY: 'openrouter-key',
      KANAREK_REVIEW_DECISION_PROVIDER_ORDER: 'openrouter',
    },
    ((_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const model = String(body.model ?? '');
      models.push(model);
      if (model === 'inception/mercury-decide:free') {
        return Promise.resolve(Response.json({
          error: { code: 'upstream_unavailable' },
        }, { status: 503 }));
      }
      return Promise.resolve(Response.json({
        model: 'respan/span-01-lite:free',
        answers: { keep_0: { type: 'noul', noul: 0.95 } },
        usage: { input_tokens: 47 },
      }));
    }) as typeof fetch,
  );

  assert.equal(response?.status, 200);
  assert.deepEqual(models, [
    'inception/mercury-decide:free',
    'respan/span-01-lite:free',
  ]);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'openrouter-decision');
  assert.equal(response?.headers.get('x-kanarek-review-model'), 'respan/span-01-lite:free');
});

test('OpenRouter Decisions accepts canonicalized free-model response ids', async () => {
  const response = await handleDecisionModelRequest(
    request({
      state: { review: 'canonical model id' },
      questions: { keep_0: { type: 'noul' } },
    }),
    {
      ...env,
      AIHUBMIX_API_KEY: undefined,
      OPENROUTER_API_KEY: 'openrouter-key',
      KANAREK_REVIEW_DECISION_PROVIDER_ORDER: 'openrouter',
    },
    (() => Promise.resolve(Response.json({
      model: 'inception/mercury-decide-20260930',
      answers: { keep_0: { type: 'noul', noul: 0.93 } },
    }))) as typeof fetch,
  );

  assert.equal(response?.status, 200);
  assert.equal(
    response?.headers.get('x-kanarek-review-model'),
    'inception/mercury-decide-20260930',
  );
});
