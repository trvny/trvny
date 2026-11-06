import assert from 'node:assert/strict';
import test from 'node:test';

import {
  grokTokenTarget,
  verifyGrokOidc,
  handleGrokTokenExchange,
} from '../src/companion/grok-review-oidc.ts';

const now = 1_800_000_000;

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function signedToken(claimOverrides: Record<string, unknown> = {}) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const header = base64url(new TextEncoder().encode(JSON.stringify({
    alg: 'RS256', kid: 'test-key', typ: 'JWT',
  })));
  const payload = base64url(new TextEncoder().encode(JSON.stringify({
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'https://automation.travny.workers.dev/grok-review/token',
    repository: 'travnie/.github',
    repository_id: '1351772020',
    workflow_ref: 'travnie/.github/.github/workflows/grok-review.yml@refs/heads/main',
    ref: 'refs/heads/main',
    event_name: 'repository_dispatch',
    iat: now - 20,
    exp: now + 200,
    ...claimOverrides,
  })));
  const message = new TextEncoder().encode(header + '.' + payload);
  const signature = new Uint8Array(await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', pair.privateKey, message,
  ));
  const mockFetch = async (_url: RequestInfo | URL): Promise<Response> =>
    Response.json({ keys: [{ ...publicJwk, kid: 'test-key', use: 'sig' }] });
  return { jwt: header + '.' + payload + '.' + base64url(signature),
    mockFetch: mockFetch as typeof fetch };
}

test('trust only signed tokens from trusted main-branch workflow', async () => {
  const good = await signedToken();
  assert.equal(await verifyGrokOidc(good.jwt, good.mockFetch, now), true);
  const wrongRepo = await signedToken({ repository: 'untrusted/repo' });
  assert.equal(await verifyGrokOidc(wrongRepo.jwt, wrongRepo.mockFetch, now), false);
  const wrongEvent = await signedToken({ event_name: 'pull_request' });
  assert.equal(await verifyGrokOidc(wrongEvent.jwt, wrongEvent.mockFetch, now), false);
  const wrongRef = await signedToken({ ref: 'refs/heads/pr-branch' });
  assert.equal(await verifyGrokOidc(wrongRef.jwt, wrongRef.mockFetch, now), false);
  const stale = await signedToken({ exp: now - 1 });
  assert.equal(await verifyGrokOidc(stale.jwt, stale.mockFetch, now), false);
  const tampered = good.jwt.slice(0, -2) + 'xx';
  assert.equal(await verifyGrokOidc(tampered, good.mockFetch, now), false);
});

test('review token requests are scoped to trusted GitHub organizations', () => {
  assert.equal(grokTokenTarget({ repository: 'trvny/trvny' }), 'trvny/trvny');
  assert.equal(grokTokenTarget({ repository: 'travnie/aistee' }), 'travnie/aistee');
  assert.equal(grokTokenTarget({ repository: 'attacker/evil' }), null);
  assert.equal(grokTokenTarget({ repository: '../../evil' }), null);
});

test('token exchange requires valid Authorization before reading target', async () => {
  const res = await handleGrokTokenExchange(
    new Request('https://automation.travny.workers.dev/grok-review/token', {
      method: 'POST', body: '{"repository":"travnie/aistee"}',
    }),
    { GITHUB_APP_ID: '', GITHUB_PRIVATE_KEY: '' },
  );
  assert.equal(res.status, 401);
});
