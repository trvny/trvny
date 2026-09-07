import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleSpecialistMcp,
  MCP_PROTOCOL_VERSION,
} from '../src/mcp-adapter.ts';

const origin = 'https://example.workers.dev';

function rpcRequest(
  body: unknown,
  method: string,
  name?: string,
  protocolVersion = MCP_PROTOCOL_VERSION,
): Request {
  const headers: Record<string, string> = {
    authorization: 'Bearer github-oauth-token',
    'content-type': 'application/json',
    'mcp-protocol-version': protocolVersion,
    'mcp-method': method,
  };
  if (name) headers['mcp-name'] = name;
  return new Request(`${origin}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function authorizedInvoke(): (input: Request) => Promise<Response> {
  return async (input) => {
    assert.equal(new URL(input.url).pathname, '/gpt-actions/github/read');
    assert.equal(input.headers.get('authorization'), 'Bearer github-oauth-token');
    assert.deepEqual(await input.json(), { path: '/user' });
    return Response.json({ ok: true, data: { login: 'trvny' } });
  };
}

test('MCP discovery advertises a stateless 2026 specialist server', async () => {
  const response = await handleSpecialistMcp(
    rpcRequest({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} }, 'server/discover'),
    {},
    authorizedInvoke(),
  );
  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('mcp-protocol-version'), MCP_PROTOCOL_VERSION);
  const payload = await response.json() as {
    result: { resultType: string; supportedVersions: string[]; capabilities: unknown };
  };
  assert.equal(payload.result.resultType, 'complete');
  assert.ok(payload.result.supportedVersions.includes(MCP_PROTOCOL_VERSION));
  assert.ok(payload.result.capabilities);
});

test('MCP tools/list is generated from the shared specialist registry', async () => {
  const response = await handleSpecialistMcp(
    rpcRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, 'tools/list'),
    {},
    authorizedInvoke(),
  );
  assert.ok(response);
  const payload = await response.json() as {
    result: { resultType: string; tools: Array<{ name: string }> };
  };
  assert.equal(payload.result.resultType, 'complete');
  assert.deepEqual(
    payload.result.tools.map((tool) => tool.name).sort(),
    [
      'context7_search',
      'engram_search',
      'engram_status',
      'engram_store',
      'feedseek_fetch',
      'feedseek_recent',
      'feedseek_search',
    ],
  );
});

test('MCP Context7 call executes the same bounded specialist core as Actions', async () => {
  const fetcher: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v2/context');
    assert.equal(url.searchParams.get('libraryId'), '/upstash/context7');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer ctx7_test');
    return Promise.resolve(Response.json({
      codeSnippets: [],
      infoSnippets: [{ breadcrumb: 'API', content: 'Use the v2 context endpoint.' }],
    }));
  };
  const body = {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'context7_search',
      arguments: {
        libraryName: 'Context7',
        libraryId: '/upstash/context7',
        query: 'REST API',
      },
    },
  };
  const response = await handleSpecialistMcp(
    rpcRequest(body, 'tools/call', 'context7_search'),
    { CONTEXT7_API_KEY: 'ctx7_test' },
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  const payload = await response.json() as {
    result: {
      resultType: string;
      isError: boolean;
      structuredContent: { ok: boolean; resolved: boolean; snippets: Array<{ content: string }> };
    };
  };
  assert.equal(payload.result.resultType, 'complete');
  assert.equal(payload.result.isError, false);
  assert.equal(payload.result.structuredContent.ok, true);
  assert.equal(payload.result.structuredContent.resolved, false);
  assert.equal(payload.result.structuredContent.snippets[0].content, 'Use the v2 context endpoint.');
});

test('MCP Feedseek call stays a fixed read-only remote MCP bridge', async () => {
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(String(input), 'https://feeds.trfny.com/mcp');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('mcp-protocol-version'), '2026-07-28');
    const request = JSON.parse(String(init?.body)) as {
      method: string;
      params: { name: string; arguments: Record<string, unknown> };
    };
    assert.equal(request.method, 'tools/call');
    assert.equal(request.params.name, 'recent');
    assert.deepEqual(request.params.arguments, {
      query: 'OpenAI',
      sources: ['openai'],
      limit: 5,
    });
    return Response.json({
      jsonrpc: '2.0',
      id: 'gremlin-recent',
      result: {
        resultType: 'complete',
        content: [{ type: 'text', text: '{}' }],
        structuredContent: {
          indexed_from: '2026-09-07T00:00:00Z',
          truncated: false,
          skipped_sources: [],
          count: 1,
          entries: [{ id: 'entry:1', title: 'OpenAI update', url: 'https://example.test' }],
        },
      },
    });
  };
  const body = {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'feedseek_recent',
      arguments: { query: 'OpenAI', sources: ['openai'], limit: 5 },
    },
  };
  const response = await handleSpecialistMcp(
    rpcRequest(body, 'tools/call', 'feedseek_recent'),
    {},
    authorizedInvoke(),
    fetcher,
  );
  assert.ok(response);
  const payload = await response.json() as {
    result: { structuredContent: { ok: boolean; count: number } };
  };
  assert.equal(payload.result.structuredContent.ok, true);
  assert.equal(payload.result.structuredContent.count, 1);
});

test('MCP fails authentication before any specialist credential is touched', async () => {
  let upstreamCalls = 0;
  const response = await handleSpecialistMcp(
    rpcRequest({ jsonrpc: '2.0', id: 5, method: 'tools/list', params: {} }, 'tools/list'),
    { CONTEXT7_API_KEY: 'ctx7_secret', ENGRAM_API_KEY: 'engram_secret' },
    () => Promise.resolve(Response.json({ ok: false, error: 'forbidden' }, { status: 403 })),
    () => {
      upstreamCalls += 1;
      return Promise.reject(new Error('upstream must not be called'));
    },
  );
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.equal(upstreamCalls, 0);
  const text = await response.text();
  assert.equal(text.includes('ctx7_secret'), false);
  assert.equal(text.includes('engram_secret'), false);
});

test('legacy initialize remains available for 2025 MCP clients', async () => {
  const request = rpcRequest(
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'legacy-test', version: '1' },
      },
    },
    'initialize',
    undefined,
    '2025-11-25',
  );
  const response = await handleSpecialistMcp(request, {}, authorizedInvoke());
  assert.ok(response);
  const payload = await response.json() as { result: { protocolVersion: string } };
  assert.equal(payload.result.protocolVersion, '2025-11-25');
});
