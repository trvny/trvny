import assert from 'node:assert/strict';
import test from 'node:test';

import { createActionFetch } from '../src/action-context.ts';
import { handleBatchAction } from '../src/batch-actions.ts';
import { customGptOpenApi } from '../src/router.ts';

type Env = Parameters<typeof handleBatchAction>[1];

test('batch read is exposed in Custom GPT OpenAPI', () => {
  const document = customGptOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  const batch = operations.find((operation) => operation.operationId === 'githubReadBatch');

  assert.ok(batch);
  assert.ok(!batch.description || batch.description.length <= 300);
});

test('batch read verifies the OAuth user once and returns partial failures per path', async () => {
  const calls: string[] = [];
  const upstream: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    calls.push(`${request.method} ${url.pathname}`);

    if (url.pathname === '/user') {
      return Response.json({ login: 'trvny', id: 120686325 });
    }
    if (url.pathname === '/repos/trvny/trvny') {
      return Response.json({ name: 'trvny', default_branch: 'main' });
    }
    if (url.pathname === '/repos/trvny/missing') {
      return Response.json({ message: 'Not Found' }, { status: 404 });
    }
    return Response.json({ message: 'unexpected' }, { status: 500 });
  };
  const optimized = createActionFetch(upstream);
  const request = new Request('https://example.workers.dev/gpt-actions/github/read-batch', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer batch-user-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      paths: [
        '/repos/trvny/trvny',
        '/repos/trvny/missing',
        '/repos/trvny/trvny',
      ],
    }),
  });

  const response = await handleBatchAction(request, {} as Env, optimized);
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    count: number;
    uniqueCount: number;
    results: Array<{ ok: boolean; path: string; status: number; error?: string }>;
  };

  assert.equal(payload.count, 3);
  assert.equal(payload.uniqueCount, 2);
  assert.equal(payload.results[0].ok, true);
  assert.equal(payload.results[1].ok, false);
  assert.equal(payload.results[1].status, 404);
  assert.match(payload.results[1].error ?? '', /^github_404/);
  assert.equal(payload.results[2].ok, true);
  assert.equal(calls.filter((call) => call === 'GET /user').length, 1);
  assert.equal(calls.filter((call) => call === 'GET /repos/trvny/trvny').length, 1);
});

test('batch read rejects an out-of-scope path before touching GitHub', async () => {
  let calls = 0;
  const upstream: typeof fetch = async () => {
    calls += 1;
    return Response.json({});
  };
  const request = new Request('https://example.workers.dev/gpt-actions/github/read-batch', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer batch-user-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ paths: ['/repos/openai/openai'] }),
  });

  const response = await handleBatchAction(request, {} as Env, createActionFetch(upstream));
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
});
