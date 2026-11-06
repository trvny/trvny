import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { dispatchGrokReview } from '../src/companion/grok-review-dispatch.ts';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const target = {
  repository: 'trvny/trvny',
  number: 1328,
  head_sha: 'a'.repeat(40),
};

test('dispatch falls back only when the primary installation lacks contents write', async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    switch (requests.length) {
      case 1: return Response.json({ id: 100 });
      case 2: return Response.json({
        token: 'ghs_kanarek',
        expires_at: '2099-01-01T00:00:00Z',
        permissions: { contents: 'read' },
      });
      case 3: return Response.json({ id: 200 });
      case 4: return Response.json({
        token: 'ghs_dispatch_only',
        expires_at: '2099-01-01T00:00:00Z',
        permissions: { contents: 'write' },
      });
      case 5: return new Response(null, { status: 204 });
      default: throw new Error('unexpected_request');
    }
  }) as typeof fetch;

  await dispatchGrokReview(target, {
    GITHUB_APP_ID: '1000',
    GITHUB_PRIVATE_KEY: pem,
    GPTOMEK_APP_ID: '2000',
    GPTOMEK_PRIVATE_KEY: pem,
  }, fakeFetch);

  assert.equal(requests.length, 5);
  assert.match(requests[4].url, /\/repos\/travnie\/\.github\/dispatches$/);
  assert.deepEqual(requests[4].body, {
    event_type: 'grok-pr-review',
    client_payload: target,
  });
});

test('no fallback or extra dispatch when primary has contents write', async () => {
  const urls: string[] = [];
  const fakeFetch: typeof fetch = (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    if (urls.length === 1) return Response.json({ id: 100 });
    if (urls.length === 2) return Response.json({
      token: 'ghs_kanarek',
      expires_at: '2099-01-01T00:00:00Z',
      permissions: { contents: 'write' },
    });
    if (urls.length === 3) return new Response(null, { status: 204 });
    throw new Error('unexpected_request');
  }) as typeof fetch;
  await dispatchGrokReview(target, {
    GITHUB_APP_ID: '1000',
    GITHUB_PRIVATE_KEY: pem,
    GPTOMEK_APP_ID: '2000',
    GPTOMEK_PRIVATE_KEY: pem,
  }, fakeFetch);
  assert.equal(urls.length, 3);
});
