import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BACON_IPSUM_URL, baconFallbackEligible, createBaconPost,
  generateWithBaconFallback, loadBaconFallback,
} from '../bacon-fallback.mjs';

test('Bacon Ipsum URL has a valid, short English-source query', () => {
  const url = new URL(BACON_IPSUM_URL);
  assert.equal(url.host, 'baconipsum.com');
  assert.equal(url.searchParams.get('type'), 'meat-and-filler');
  assert.equal(url.searchParams.get('sentences'), '2');
});

test('language roulette stays stable for a run and covers eight languages', () => {
  const source = 'Bacon andouille pastrami brisket pork belly.';
  const first = createBaconPost({ seed: '101.1', source });
  assert.deepEqual(createBaconPost({ seed: '101.1', source }), first);
  assert.equal(first.fallback, true);
  assert.equal(first.provider, 'baconipsum');
  assert.equal(first.content.kind, 'text');
  assert.ok(first.content.text.length > 45 && first.content.text.length < 2_400);
  assert.match(first.model, /^bacon-fallback\/[a-z]{2}$/);
  const codes = new Set(Array.from({ length: 200 }, (_, n) =>
    createBaconPost({ seed: String(n), source }).language));
  assert.equal(codes.size, 8);
});

test('API source determines the ingredient, without copying its English filler', () => {
  const text = createBaconPost({ seed: 'known', source: 'Bacon bacon bacon.' }).content.text;
  assert.match(text, /boczek|bacon|Speck|pancetta|бекон|ベーコン/i);
  assert.doesNotMatch(text, /lorem ipsum|dolor sit amet/i);
});

test('quota exhaustion triggers only one Bacon API call and a valid text draft', async () => {
  let calls = 0;
  const result = await generateWithBaconFallback({
    seed: 'hi',
    generate: async () => { throw new Error('router_failed:429:quota exceeded'); },
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(url, BACON_IPSUM_URL);
      assert.ok(init.signal);
      return new Response(JSON.stringify(['Pastrami brisket beef ribs sausage.']), { status: 200 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.provider, 'baconipsum');
  assert.equal(result.content.kind, 'text');
});

test('successful model text and meme do not contact Bacon Ipsum', async () => {
  for (const content of [
    { kind: 'text', text: 'real post' },
    { kind: 'meme', template: 'bad', top_text: 'ok', bottom_text: '' },
  ]) {
    const result = await generateWithBaconFallback({
      generate: async () => ({ content, provider: 'groq', model: 'free-model' }),
      fetchImpl: () => { throw new Error('Bacon must not be requested'); },
    });
    assert.equal(result.fallback, false);
    assert.deepEqual(result.content, content);
  }
});

test('generation exhaustion, missing/invalid content and transport errors allow fallback', () => {
  for (const error of [
    new Error('router_deadline_exceeded'), new Error('router_missing_content'),
    new Error('router_fetch_failed:TypeError:UND_ERR_SOCKET'),
    new Error('router_failed:503:outage'), new Error('router_failed:402:payment required'),
    new Error('router_failed:429:quota'), new Error('content_invalid_text'),
    new Error('content_unexpected_kind'), new Error('content_not_object'),
    new SyntaxError('broken JSON'),
  ]) assert.equal(baconFallbackEligible(error), true, error.message);
});

test('authorization, malformed requests and misconfiguration still fail closed', async () => {
  for (const message of [
    'router_failed:401:unauthorized', 'router_failed:403:forbidden',
    'router_failed:400:invalid request',
    'KANAREK_REVIEW_ROUTER_TOKEN is required', 'style_reference_empty',
  ]) {
    assert.equal(baconFallbackEligible(new Error(message)), false);
    await assert.rejects(generateWithBaconFallback({
      generate: async () => { throw new Error(message); },
      fetchImpl: () => { throw new Error('Unexpected Bacon request'); },
    }), (error) => error.message === message);
  }
});

test('Bacon API outage and invalid response fall back to local data', async () => {
  for (const fetchImpl of [
    async () => { throw new TypeError('offline'); },
    async () => new Response('service unavailable', { status: 503 }),
    async () => new Response(JSON.stringify([]), { status: 200 }),
    async () => new Response(JSON.stringify(['x'.repeat(10_001)]), { status: 200 }),
    async () => new Response(JSON.stringify(['x'.repeat(200_000)]), { status: 200 }),
  ]) {
    const post = await loadBaconFallback({ seed: 'offline', fetchImpl });
    assert.equal(post.provider, 'bacon-offline');
    assert.equal(post.content.kind, 'text');
    assert.ok(post.content.text.length > 20);
  }
});

test('Bacon response enforces the byte cap even when content-length is missing', async () => {
  let cancelled = false;
  const oversized = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(20_000));
    },
    cancel() { cancelled = true; },
  });
  const post = await loadBaconFallback({
    seed: 'oversize',
    fetchImpl: async () => new Response(oversized, { status: 200 }),
  });
  assert.equal(post.provider, 'bacon-offline');
  assert.equal(cancelled, true);
});

test('fallback degrades a failed meme request to a readable text post', async () => {
  const result = await generateWithBaconFallback({
    seed: 'meme-slot',
    generate: async () => { throw new Error('router_missing_content'); },
    fetchImpl: async () => new Response(JSON.stringify(['Brisket.']), { status: 200 }),
  });
  assert.equal(result.content.kind, 'text');
  assert.match(result.model, /^bacon-fallback\//);
});
