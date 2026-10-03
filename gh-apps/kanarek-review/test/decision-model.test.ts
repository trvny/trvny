import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
