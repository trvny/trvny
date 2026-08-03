import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';

import {
  checkInstallationAccess,
  createAppJwt,
  ensureTestComment,
  TEST_COMMENT_MARKER,
} from '../src/github-app.ts';

function testKeyPair() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

function privateKeyPem(): string {
  return testKeyPair().privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
}

function installationToken(): Response {
  return Response.json({
    token: 'ghs_comment_token',
    expires_at: '2026-08-04T00:30:00Z',
  });
}

function botComment(id = 321): Record<string, unknown> {
  return {
    id,
    html_url: `https://github.com/trvny/trvny/pull/149#issuecomment-${id}`,
    body: `${TEST_COMMENT_MARKER}\nalready here`,
    user: {
      login: 'kanarek-companion[bot]',
      type: 'Bot',
    },
  };
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
  const pem = privateKeyPem();
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

test('creates one marked pull request comment', async () => {
  const pem = privateKeyPem();
  const calls: string[] = [];

  const fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    calls.push(`${init?.method ?? 'GET'} ${url}`);

    if (url.endsWith('/app/installations/123/access_tokens')) {
      return installationToken();
    }

    if (url.endsWith('/issues/149/comments?per_page=100')) {
      assert.equal(headers.get('authorization'), 'Bearer ghs_comment_token');
      return Response.json([]);
    }

    if (url.endsWith('/issues/149/comments') && init?.method === 'POST') {
      assert.equal(headers.get('authorization'), 'Bearer ghs_comment_token');
      assert.equal(headers.get('content-type'), 'application/json');
      const requestBody = JSON.parse(String(init.body)) as { body: string };
      assert.equal(requestBody.body.includes(TEST_COMMENT_MARKER), true);
      assert.match(requestBody.body, /kanarek-companion:delivery:delivery-123/);
      return Response.json(
        {
          id: 321,
          html_url: 'https://github.com/trvny/trvny/pull/149#issuecomment-321',
        },
        { status: 201 },
      );
    }

    return new Response(null, { status: 404 });
  };

  const result = await ensureTestComment(
    '4472094',
    'kanarek-companion',
    pem,
    123,
    'trvny/trvny',
    149,
    'delivery-123',
    fetcher,
  );

  assert.deepEqual(result, {
    commentId: 321,
    commentUrl: 'https://github.com/trvny/trvny/pull/149#issuecomment-321',
    created: true,
    expiresAt: '2026-08-04T00:30:00Z',
  });
  assert.equal(JSON.stringify(result).includes('ghs_comment_token'), false);
  assert.equal(calls.length, 3);
});

test('reuses only a marked comment authored by the app bot', async () => {
  const pem = privateKeyPem();
  let createCalls = 0;

  const fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);

    if (url.endsWith('/app/installations/123/access_tokens')) {
      return installationToken();
    }

    if (url.endsWith('/issues/149/comments?per_page=100')) {
      return Response.json([botComment()]);
    }

    if (url.endsWith('/issues/149/comments') && init?.method === 'POST') {
      createCalls += 1;
    }
    return new Response(null, { status: 404 });
  };

  const result = await ensureTestComment(
    '4472094',
    'kanarek-companion',
    pem,
    123,
    'trvny/trvny',
    149,
    'delivery-123',
    fetcher,
  );

  assert.deepEqual(result, {
    commentId: 321,
    commentUrl: 'https://github.com/trvny/trvny/pull/149#issuecomment-321',
    created: false,
    expiresAt: '2026-08-04T00:30:00Z',
  });
  assert.equal(createCalls, 0);
});

test('follows pagination before deciding to create a comment', async () => {
  const pem = privateKeyPem();
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    body: 'ordinary comment',
  }));
  let createCalls = 0;

  const fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);

    if (url.endsWith('/app/installations/123/access_tokens')) {
      return installationToken();
    }

    if (url.endsWith('/issues/149/comments?per_page=100')) {
      return Response.json(firstPage, {
        headers: {
          Link: '<https://api.github.com/repos/trvny/trvny/issues/149/comments?per_page=100&page=2>; rel="next"',
        },
      });
    }

    if (url.endsWith('/issues/149/comments?per_page=100&page=2')) {
      return Response.json([botComment(654)]);
    }

    if (url.endsWith('/issues/149/comments') && init?.method === 'POST') {
      createCalls += 1;
    }
    return new Response(null, { status: 404 });
  };

  const result = await ensureTestComment(
    '4472094',
    'kanarek-companion',
    pem,
    123,
    'trvny/trvny',
    149,
    'delivery-123',
    fetcher,
  );

  assert.deepEqual(result, {
    commentId: 654,
    commentUrl: 'https://github.com/trvny/trvny/pull/149#issuecomment-654',
    created: false,
    expiresAt: '2026-08-04T00:30:00Z',
  });
  assert.equal(createCalls, 0);
});
