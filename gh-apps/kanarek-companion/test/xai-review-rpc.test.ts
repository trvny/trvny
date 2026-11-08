import assert from 'node:assert/strict';
import test from 'node:test';

import { grokReviewRequest, requestGrokReview } from '../src/companion/xai-review-rpc.ts';

const review = {
  model: 'grok-4.7',
  messages: [
    { role: 'system', content: 'Review changed lines. Reply with JSON.' },
    { role: 'user', content: 'Changed code: fix.' },
  ],
  max_tokens: 36_864,
};

test('Grok RPC request uses bounded, structured, stateless Responses', () => {
  const request = grokReviewRequest(review)!;
  assert.equal(request.model, 'grok-4.7');
  assert.equal(request.store, false);
  assert.equal(request.prompt_cache_key, 'kanarek-paid-code-review-v1');
  assert.equal(request.max_output_tokens, 36_864);
  assert.deepEqual(request.reasoning, { effort: 'high' });
  assert.equal((request.text as { format: { type: string } }).format.type, 'json_schema');
  assert.equal(request.tools, undefined);
  assert.equal(grokReviewRequest({ ...review, model: 'other' }), null);
  assert.equal(grokReviewRequest({ ...review, stream: true }), null);
});

test('Grok RPC carries configured model, effort and paid output budget', () => {
  const configured = grokReviewRequest({
    ...review,
    model: 'grok-4.6',
    reasoning: { effort: 'xhigh' },
    max_tokens: 65_536,
  })!;
  assert.equal(configured.model, 'grok-4.6');
  assert.deepEqual(configured.reasoning, { effort: 'xhigh' });
  assert.equal(configured.max_output_tokens, 65_536);
  assert.equal(grokReviewRequest({ ...review, model: 'unknown' }), null);
  assert.deepEqual(grokReviewRequest({ ...review, reasoning: { effort: 'off' } })?.reasoning,
    { effort: 'high' });
});

test('Grok RPC maps completed Responses into Kanarek review', async () => {
  const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(url), 'https://api.x.ai/v1/responses');
    const outbound = JSON.parse(String(init?.body)) as { model: string };
    assert.equal(outbound.model, 'grok-4.7');
    return Response.json({
      status: 'completed',
      model: 'grok-4.7',
      usage: { input_tokens: 123, output_tokens: 45 },
      output: [{ content: [{ type: 'output_text',
        text: '{"summary":"No bugs","findings":[]}' }] }],
    });
  }) as typeof fetch;
  const response = await requestGrokReview(review, 'dummy', fetcher);
  assert.equal(response.status, 200);
  const first = (response.payload.choices as Array<{ message: { content: string } }>)[0];
  assert.equal(first.message.content, '{"summary":"No bugs","findings":[]}');
  assert.equal((response.payload.usage as { prompt_tokens: number }).prompt_tokens, 123);
});

test('Grok RPC hides upstream response bodies and rejects incomplete output', async () => {
  const denied = await requestGrokReview(review, 'dummy',
    (async () => Response.json({ error: { message: 'private upstream details' } },
      { status: 429 })) as typeof fetch);
  assert.equal(denied.status, 429);
  assert.equal(JSON.stringify(denied).includes('private upstream'), false);
  const incomplete = await requestGrokReview(review, 'dummy',
    (async () => Response.json({ status: 'incomplete', output: [] })) as typeof fetch);
  assert.equal(incomplete.status, 502);
  assert.equal((await requestGrokReview(review, '', fetch)).status, 503);
});

test('Grok RPC distinguishes timed-out calls without leaking upstream data', async () => {
  const timedOut = await requestGrokReview(review, 'dummy',
    (async () => { throw new DOMException('deadline exceeded', 'TimeoutError'); }) as typeof fetch);
  assert.equal(timedOut.status, 502);
  assert.equal((timedOut.payload.error as { code: string }).code, 'xai_timeout');
});
