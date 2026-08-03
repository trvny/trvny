import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';

import {
  checkInstallationAccess,
  createAppJwt,
} from '../src/github-app.ts';

function testKeyPair() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

test('signs a GitHub App JWT with a PKCS#1 private key', async () => {
  const { privateKey, publicKey } = testKeyPair();
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const now = 1_700_000_000;
  const jwt = await createAppJwt('4472094', pem, now);
  const [header, payload, signature] = jwt.split('.');

  assert.deepEqual(
    JSON.parse(Buffer.from(header, 'base64url').toString('utf8')),
    { alg: 'RS256', typ: 'JWT' },
  );
  assert.deepEqual(
    JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    {
      iat: now - 60,
      exp: now + 480,
      iss: '4472094',
    },
  );
  assert.equal(
    verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    ),
    true,
  );
});

test('accepts a private key stored with escaped newlines', async () => {
  const { privateKey, publicKey } = testKeyPair();
  const pem = privateKey
    .export({ type: 'pkcs1', format: 'pem' })
    .toString()
    .replace(/\n/g, '\\n');
  const jwt = await createAppJwt('4472094', pem, 1_700_000_000);
  const [header, payload, signature] = jwt.split('.');

  assert.equal(
    verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, 'base64url'),
    ),
    true,
  );
});

test('exchanges the JWT and verifies repository access', async () => {
  const { privateKey } = testKeyPair();
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  const calls: string[] = [];

  const fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    const authorization = new Headers(init?.headers).get('authorization');
    calls.push(url);

    if (url.endsWith('/app/installations/123/access_tokens')) {
      assert.match(authorization ?? '', /^Bearer eyJ/);
      assert.equal(init?.method, 'POST');
      return Response.json({
        token: 'ghs_test_token',
        expires_at: '2026-08-03T23:30:00Z',
      });
    }

    if (url.endsWith('/installation/repositories?per_page=1')) {
      assert.equal(authorization, 'Bearer ghs_test_token');
      return Response.json({ total_count: 1, repositories: [] });
    }

    return new Response(null, { status: 404 });
  };

  const result = await checkInstallationAccess(
    '4472094',
    pem,
    123,
    fetcher,
  );

  assert.deepEqual(result, {
    expiresAt: '2026-08-03T23:30:00Z',
    repositoryCount: 1,
  });
  assert.deepEqual(calls, [
    'https://api.github.com/app/installations/123/access_tokens',
    'https://api.github.com/installation/repositories?per_page=1',
  ]);
  assert.equal(JSON.stringify(result).includes('ghs_test_token'), false);
});
