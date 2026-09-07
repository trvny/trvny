import assert from 'node:assert/strict';
import test from 'node:test';

import { addFeedseekOpenApi, handleFeedseekAction } from '../src/feedseek-actions.ts';

const origin = 'https://example.workers.dev';

function request(path: string, body: unknown): Request {
  return new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer github-oauth-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function authorizedInvoke(): (input: Request) => Promise<Response> {
  return async (input) => {
    assert.equal(new URL(input.url).pathname, '/gpt-actions/github/read');
    assert.deepEqual(await input.json(), { path: '/user' });
    return Response.json({ ok: true, data: { login: 'trvny' } });
  };
}

function feedseekResponse(structuredContent: Record<string, unknown>): Response {
  return Response.json({
    jsonrpc: '2.0',
    id: 'gremlin-test',
    result: {
      resultType: 'complete',
      content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
      structuredContent,
    },
  });
}

test('Feedseek Actions appear in OpenAPI with operator OAuth', () => {
  const document: Record<string, unknown> = { paths: {} };
  addFeedseekOpenApi(document);
  const paths = document.paths as Record<string, { post: { operationId: string; security: unknown } }>;
  assert.equal(paths['/gpt-actions/feedseek/search'].post.operationId, 'searchFeedseek');
  assert.equal(paths['/gpt-actions/feedseek/fetch'].post.operationId, 'fetchFeedseekEntry');
  assert.equal(paths['/gpt-actions/feedseek/recent'].post.operationId, 'getRecentFeedseekEntries');
  assert.deepEqual(paths['/gpt-actions/feedseek/recent'].post.security, [{ githubOAuth: [] }]);
});

test('Feedseek recent delegates only to the fixed remote MCP endpoint', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'https://feeds.trfny.com/mcp');
    assert.equal(new Headers(init?.headers).get('mcp-protocol-version'), '2026-07-28');
    const body = JSON.parse(String(init?.body)) as {
      method: string;
      params: { name: string; arguments: Record<string, unknown> };
    };
    assert.equal(body.method, 'tools/call');
    assert.equal(body.params.name, 'recent');
    assert.deepEqual(body.params.arguments, {
      query: 'AI',
      sources: ['openai', 'anthropic'],
      limit: 10,
      since: '2026-09-06T00:00:00Z',
    });
    return feedseekResponse({
      indexed_from: '2026-09-07T00:00:00Z',
      truncated: false,
      skipped_sources: [],
      count: 1,
      entries: [{ id: 'opaque:1', title: 'AI update', url: 'https://example.test' }],
    });
  };

  const response = await handleFeedseekAction(
    request('/gpt-actions/feedseek/recent', {
      query: 'AI',
      sources: ['openai', 'anthropic'],
      limit: 10,
      since: '2026-09-06T00:00:00Z',
    }),
    {},
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await response.json() as { ok: boolean; count: number };
  assert.equal(payload.ok, true);
  assert.equal(payload.count, 1);
});

test('Feedseek fetch keeps opaque ids and external text bounded behind the provider', async () => {
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      params: { name: string; arguments: Record<string, unknown> };
    };
    assert.equal(body.params.name, 'fetch');
    assert.deepEqual(body.params.arguments, { id: 'opaque:feed:entry' });
    return feedseekResponse({
      id: 'opaque:feed:entry',
      title: 'Entry',
      text: 'Untrusted article text.',
      url: 'https://example.test/article',
      metadata: { source: 'Example' },
    });
  };

  const response = await handleFeedseekAction(
    request('/gpt-actions/feedseek/fetch', { id: 'opaque:feed:entry' }),
    {},
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  assert.deepEqual(await response.json(), {
    ok: true,
    id: 'opaque:feed:entry',
    title: 'Entry',
    text: 'Untrusted article text.',
    url: 'https://example.test/article',
    metadata: { source: 'Example' },
  });
});

test('Feedseek authorization happens before remote MCP access', async () => {
  let upstreamCalls = 0;
  const response = await handleFeedseekAction(
    request('/gpt-actions/feedseek/search', { query: 'AI' }),
    {},
    () => Promise.resolve(Response.json({ ok: false, error: 'forbidden' }, { status: 403 })),
    () => {
      upstreamCalls += 1;
      return Promise.reject(new Error('Feedseek must not be called'));
    },
  );
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.equal(upstreamCalls, 0);
});
