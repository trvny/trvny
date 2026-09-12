import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleReviewRouterViaService,
  reviewProviderPoolHealthViaService,
  type ReviewServiceEnv,
} from '../src/review-service.ts';
import {
  REVIEW_ROUTER_MODELS_PATH,
  REVIEW_WORKERS_AI_OVERRIDE_HEADER,
} from '../src/review-router.ts';

function modelsRequest(): Request {
  return new Request(`https://kanarek.example${REVIEW_ROUTER_MODELS_PATH}`, {
    headers: { Authorization: 'Bearer test-token' },
  });
}

const localEnv: ReviewServiceEnv = {
  KANAREK_REVIEW_ROUTER_TOKEN: 'test-token',
};

test('review service adapter keeps the local router as the default', async () => {
  const response = await handleReviewRouterViaService(modelsRequest(), localEnv);
  assert.equal(response?.status, 200);
  const body = await response?.json() as { data?: Array<{ id?: string }> };
  assert.equal(body.data?.[0]?.id, 'kanarek-review-free');
});

test('review service adapter forwards through the binding and preserves retry policy', async () => {
  let workersAiHeader: string | null = null;
  const env: ReviewServiceEnv = {
    ...localEnv,
    KANAREK_REVIEW_WORKERS_AI_ENABLED: 'false',
    KANAREK_REVIEW_SERVICE: {
      async fetch(input) {
        const request = input instanceof Request ? input : new Request(input);
        workersAiHeader = request.headers.get(REVIEW_WORKERS_AI_OVERRIDE_HEADER);
        return Response.json({ object: 'list', data: [{ id: 'remote-review' }] });
      },
    },
  };

  const response = await handleReviewRouterViaService(modelsRequest(), env);
  assert.equal(response?.status, 200);
  assert.equal(workersAiHeader, 'false');
  const body = await response?.json() as { data?: Array<{ id?: string }> };
  assert.equal(body.data?.[0]?.id, 'remote-review');
});

test('review service adapter falls back locally when the binding transport fails', async () => {
  const response = await handleReviewRouterViaService(modelsRequest(), {
    ...localEnv,
    KANAREK_REVIEW_SERVICE: {
      fetch() {
        return Promise.reject(new Error('service unavailable'));
      },
    },
  });
  assert.equal(response?.status, 200);
});

test('review health uses the bound worker provider pool when available', async () => {
  const providerPool = {
    available: 1,
    configured: 1,
    ready: true,
    providers: [{ provider: 'openrouter', configured: true, available: true }],
  };
  const health = await reviewProviderPoolHealthViaService({
    ...localEnv,
    KANAREK_REVIEW_SERVICE: {
      fetch() {
        return Promise.resolve(Response.json({ ok: true, providerPool }));
      },
    },
  });

  assert.deepEqual(health, providerPool);
});
