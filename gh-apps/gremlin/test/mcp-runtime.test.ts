import assert from 'node:assert/strict';
import test from 'node:test';

import { gremlinMcpManifest, handleGremlinMcp } from '../src/mcp-runtime.ts';

const ORIGIN = 'https://gremlin.internal';

test('Gremlin assembles and dispatches its authenticated MCP surface', async () => {
  let operatorCalls = 0;
  let feedseekCalls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === 'https://api.github.com/user') {
      assert.equal(request.headers.get('authorization'), 'Bearer mock-gremlin-token');
      return Response.json({ login: 'trvny', id: 120686325 });
    }
    assert.equal(request.url, 'https://feeds.trfny.com/mcp');
    feedseekCalls += 1;
    const body = await request.json() as { params: { name: string; arguments: { limit: number } } };
    assert.equal(body.params.name, 'recent');
    assert.equal(body.params.arguments.limit, 1);
    return Response.json({
      jsonrpc: '2.0',
      result: { structuredContent: { count: 1, entries: [{ id: 'entry:1' }] } },
    });
  };
  const invoke = async (request: Request): Promise<Response> => {
    operatorCalls += 1;
    assert.equal(request.method, 'GET');
    assert.equal(new URL(request.url).pathname, '/gpt-actions/operator/capabilities');
    assert.equal(request.headers.get('authorization'), 'Bearer mock-gremlin-token');
    return Response.json({ ok: true });
  };

  async function rpc(method: string, params: object = {}) {
    const response = await handleGremlinMcp(new Request(ORIGIN + '/mcp', {
      method: 'POST',
      headers: {
        authorization: 'Bearer mock-gremlin-token',
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }), {} as never, invoke, fetcher);
    assert.ok(response);
    assert.equal(response.status, 200);
    return await response.json() as {
      result?: { instructions?: string; serverInfo?: { name: string; icons?: unknown }; _meta?: { 'io.modelcontextprotocol/serverInfo'?: { icons?: unknown } }; tools?: Array<{ name: string }>; isError?: boolean };
      error?: { code: number };
    };
  }

  const initialize = await rpc('initialize');
  assert.equal(initialize.result?.serverInfo?.name, 'mechagremlin');
  const icons = [{ src: 'https://raw.githubusercontent.com/trvny/trvny/main/gh-apps/gremlin/plugin/assets/gpt-icon.png', mimeType: 'image/png' }];
  assert.deepEqual(initialize.result?.serverInfo?.icons, icons);
  const discovery = await rpc('server/discover');
  assert.deepEqual(discovery.result?._meta?.['io.modelcontextprotocol/serverInfo']?.icons, icons);
  assert.equal(initialize.result?.instructions, 'Guarded GPTomek workflows and Feedseek. Use direct provider apps for ordinary calls.');

  const listed = await rpc('tools/list');
  assert.deepEqual(listed.result?.tools?.map((tool) => tool.name).sort(), gremlinMcpManifest(ORIGIN).toolNames);
  assert.equal(listed.result?.tools?.length, 21);

  assert.equal((await rpc('tools/call', { name: 'getOperatorCapabilities' })).result?.isError, false);
  assert.equal((await rpc('tools/call', { name: 'feedseek_recent', arguments: { limit: 1 } })).result?.isError, false);
  assert.equal((await rpc('tools/call', { name: 'engram_search', arguments: { query: 'test' } })).error?.code, -32602);
  assert.equal(operatorCalls, 1);
  assert.equal(feedseekCalls, 1);
});
