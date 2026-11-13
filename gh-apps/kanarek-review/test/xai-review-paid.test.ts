import assert from 'node:assert/strict';
import test from 'node:test';

import { handleReviewRouterRequest } from '../src/review-router.ts';

const endpoint = 'https://kanarek-review.example/review-router/v1/chat/completions';
const paidSettings = { KANAREK_REVIEW_PAID_PROVIDER_ORDER: 'xai,deepseek,gemini-flex',
  KANAREK_REVIEW_DEEPSEEK_MODEL: 'deepseek-flash' } as const;

function req(model: string): Request {
  return new Request(endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer check', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, max_tokens: 36_864,
      messages: [{ role: 'user', content: 'Review this patch.' }],
    }),
  });
}

test('paid review selects Grok through the private RPC', async () => {
  let calls = 0;
  const response = await handleReviewRouterRequest(req('kanarek-review-paid'), {
    KANAREK_REVIEW_ROUTER_TOKEN: 'check',
    ...paidSettings,
    XAI_REVIEW_RPC: {
      async completeReview(input) {
        calls += 1;
        assert.equal(input.model, 'grok-4.7');
        assert.equal(input.max_tokens, 36_864);
        return {
          status: 200,
          payload: { model: 'grok-4.7',
            choices: [{ message: { role: 'assistant',
              content: '{"summary":"No bug","findings":[]}' } }] },
        };
      },
    },
  }, (() => { throw new Error('Unexpected public fetch'); }) as typeof fetch);
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'xai');
  assert.equal(calls, 1);
});

test('paid Grok model and reasoning are configurable via Wrangler bindings', async () => {
  const response = await handleReviewRouterRequest(req('kanarek-review-paid'), {
    KANAREK_REVIEW_ROUTER_TOKEN: 'check',
    ...paidSettings,
    KANAREK_REVIEW_XAI_MODEL: 'grok-4.6',
    KANAREK_REVIEW_XAI_REASONING_EFFORT: 'xhigh',
    XAI_REVIEW_RPC: {
      async completeReview(input) {
        assert.equal(input.model, 'grok-4.6');
        assert.deepEqual(input.reasoning, { effort: 'xhigh' });
        assert.equal(input.max_tokens, 36_864);
        return { status: 200, payload: { model: 'grok-4.6',
          choices: [{ message: { role: 'assistant',
            content: '{"summary":"No bug","findings":[]}' } }] } };
      },
    },
  }, (() => { throw new Error('Unexpected public fetch'); }) as typeof fetch);
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'xai');
});

test('paid Grok uses the shared defaults for missing or invalid bindings', async () => {
  const configurations = [
    {},
    {
      KANAREK_REVIEW_XAI_MODEL: 'unrelated-model',
      KANAREK_REVIEW_XAI_REASONING_EFFORT: 'unsupported',
    },
  ];
  for (const settings of configurations) {
    const response = await handleReviewRouterRequest(req('kanarek-review-paid'), {
      ...settings,
      KANAREK_REVIEW_ROUTER_TOKEN: 'check',
    ...paidSettings,
      XAI_REVIEW_RPC: {
        async completeReview(input) {
          assert.equal(input.model, 'grok-4.7');
          assert.deepEqual(input.reasoning, { effort: 'high' });
          return { status: 200, payload: {
            model: 'grok-4.7',
            choices: [{ message: { role: 'assistant',
              content: '{"summary":"No bug","findings":[]}' } }],
          } };
        },
      },
    }, (() => { throw new Error('Unexpected public fetch'); }) as typeof fetch);
    assert.equal(response?.status, 200);
  }
});

test('Grok is never called by the free or paid-work aliases', async () => {
  let calls = 0;
  const env = {
    KANAREK_REVIEW_ROUTER_TOKEN: 'check',
    ...paidSettings,
    XAI_REVIEW_RPC: { async completeReview() {
      calls += 1;
      return { status: 200, payload: {} };
    } },
  };
  const noFetch = (() => { throw new Error('Unexpected public fetch'); }) as typeof fetch;
  const free = await handleReviewRouterRequest(req('kanarek-code-review-free'), env, noFetch);
  const work = await handleReviewRouterRequest(req('kanarek-work-paid'), env, noFetch);
  assert.equal(free?.status, 503);
  assert.equal(work?.status, 503);
  assert.equal(calls, 0);
});

test('Grok quota error falls through to DeepSeek', async () => {
  const response = await handleReviewRouterRequest(req('kanarek-review-paid'), {
    KANAREK_REVIEW_ROUTER_TOKEN: 'check',
    ...paidSettings,
    DEEPSEEK_API_KEY: 'dummy',
    XAI_REVIEW_RPC: { async completeReview() {
      return { status: 429, payload: { error: { message: 'limited' } } };
    } },
  }, (async (input: RequestInfo | URL) => {
    assert.match(String(input), /api\.deepseek\.com/);
    return Response.json({ model: 'deepseek-flash',
      choices: [{ message: { role: 'assistant', content: 'review complete' } }] });
  }) as typeof fetch);
  assert.equal(response?.status, 200);
  assert.equal(response?.headers.get('x-kanarek-review-provider'), 'deepseek');
});
