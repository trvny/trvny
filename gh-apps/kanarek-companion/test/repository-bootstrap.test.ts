import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  dispatchRepositorySettingsBootstrap,
  repositoryCreated,
} from '../src/repository-bootstrap.ts';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 1024 })
  .privateKey
  .export({ format: 'pem', type: 'pkcs8' })
  .toString();

test('recognizes only repository.created deliveries', () => {
  assert.equal(
    repositoryCreated({
      action: 'created',
      event: 'repository',
      repository: 'travnie/new-repo',
    }),
    true,
  );
  assert.equal(
    repositoryCreated({
      action: 'renamed',
      event: 'repository',
      repository: 'travnie/new-repo',
    }),
    false,
  );
  assert.equal(
    repositoryCreated({
      action: 'created',
      event: 'pull_request',
      repository: 'travnie/new-repo',
    }),
    false,
  );
});

test('dispatches the central settings workflow for the created repository', async () => {
  const calls: Array<{ body: unknown; method: string; path: string }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push({
      body: request.body ? await request.clone().json() : null,
      method: request.method,
      path: url.pathname,
    });

    if (
      request.method === 'GET' &&
      url.pathname === '/repos/trvny/.github/installation'
    ) {
      return Response.json({ id: 99 });
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/app/installations/99/access_tokens'
    ) {
      return Response.json({
        token: 'ghs_settings',
        expires_at: '2099-01-01T00:00:00Z',
        permissions: { contents: 'write' },
      });
    }
    if (
      request.method === 'POST' &&
      url.pathname === '/repos/trvny/.github/dispatches'
    ) {
      assert.equal(request.headers.get('authorization'), 'Bearer ghs_settings');
      return new Response(null, { status: 204 });
    }
    return Response.json({ message: 'unexpected' }, { status: 500 });
  };

  await dispatchRepositorySettingsBootstrap(
    'travnie/new-repo',
    {
      GITHUB_APP_ID: '4472094',
      GITHUB_PRIVATE_KEY: privateKey,
    },
    fetcher,
  );

  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [
    ['GET', '/repos/trvny/.github/installation'],
    ['POST', '/app/installations/99/access_tokens'],
    ['POST', '/repos/trvny/.github/dispatches'],
  ]);
  assert.deepEqual(calls.at(-1)?.body, {
    event_type: 'repository-created',
    client_payload: { repository: 'travnie/new-repo' },
  });
});

test('fails closed when the central installation lacks contents write', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === '/repos/trvny/.github/installation') {
      return Response.json({ id: 99 });
    }
    if (url.pathname === '/app/installations/99/access_tokens') {
      return Response.json({
        token: 'ghs_settings',
        expires_at: '2099-01-01T00:00:00Z',
        permissions: { contents: 'read' },
      });
    }
    return new Response(null, { status: 500 });
  };

  await assert.rejects(
    dispatchRepositorySettingsBootstrap(
      'trvny/new-repo',
      {
        GITHUB_APP_ID: '4472094',
        GITHUB_PRIVATE_KEY: privateKey,
      },
      fetcher,
    ),
    /repository_bootstrap_contents_write_required/,
  );
});
