import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  ensureTestComment,
  GitHubApiError,
} from '../src/github-app.ts';

function privateKeyPem(): string {
  return generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs1', format: 'pem' })
    .toString();
}

test('logs only safe GitHub diagnostics for a rejected comment', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...values: unknown[]) => warnings.push(values.join(' '));

  const fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);

    if (url.endsWith('/app/installations/123/access_tokens')) {
      return Response.json({
        token: 'ghs_must_not_be_logged',
        expires_at: '2026-08-04T12:00:00Z',
        permissions: {
          issues: 'write',
          pull_requests: 'read',
        },
      });
    }

    if (url.endsWith('/issues/152/comments?per_page=100')) {
      return Response.json([]);
    }

    if (url.endsWith('/issues/152/comments') && init?.method === 'POST') {
      return Response.json(
        {
          message: 'Resource not accessible by integration',
          documentation_url: 'https://docs.github.com/rest/issues/comments',
        },
        {
          status: 403,
          headers: {
            'X-Accepted-GitHub-Permissions':
              'issues=write; pull_requests=write',
            'X-GitHub-Request-Id': 'ABC:123',
            'X-RateLimit-Remaining': '4999',
          },
        },
      );
    }

    return new Response(null, { status: 404 });
  };

  try {
    await assert.rejects(
      ensureTestComment(
        '4472094',
        'kanarek-companion',
        privateKeyPem(),
        123,
        'trvny/trvny',
        152,
        'delivery-123',
        fetcher,
      ),
      (error: unknown) =>
        error instanceof GitHubApiError &&
        error.operation === 'create_issue_comment' &&
        error.status === 403,
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  const diagnostic = JSON.parse(warnings[0]) as {
    githubApiDiagnostic: Record<string, unknown>;
  };
  assert.deepEqual(diagnostic.githubApiDiagnostic, {
    acceptedPermissions: 'issues=write; pull_requests=write',
    documentationUrl: 'https://docs.github.com/rest/issues/comments',
    grantedPermissions: {
      issues: 'write',
      pull_requests: 'read',
    },
    message: 'Resource not accessible by integration',
    operation: 'create_issue_comment',
    rateLimitRemaining: '4999',
    rateLimitReset: null,
    requestId: 'ABC:123',
    retryAfter: null,
    status: 403,
  });
  assert.equal(warnings[0].includes('ghs_must_not_be_logged'), false);
});
