import assert from 'node:assert/strict';
import test from 'node:test';

import {
  handleGremlinMcp as handleGremlinMcpGw,
  handleOperatorMcp as handleOperatorMcpGw,
  MCP_PROTOCOL_VERSION,
} from '../src/mcp-adapter.ts';
import {
  PLUGIN_MCP_OPERATION_IDS,
  pluginMcpOpenApi,
} from '../src/runtime-openapi.ts';
import { loopbackGateway } from './support/loopback-gateway.ts';

type Invoke = (request: Request) => Promise<Response>;
// Gateway-taking handler, driven by the route-shaped fixture.
const handleGremlinMcp = (request: Request, document: Parameters<typeof handleGremlinMcpGw>[1], env: Parameters<typeof handleGremlinMcpGw>[2], invoke: Invoke, fetcher?: typeof fetch) =>
  handleGremlinMcpGw(request, document, env, invoke, loopbackGateway(request, invoke), fetcher);
// Gateway-taking handler, driven by the route-shaped fixture.
const handleOperatorMcp = (request: Request, document: Parameters<typeof handleOperatorMcpGw>[1], invoke: Invoke) =>
  handleOperatorMcpGw(request, document, invoke, loopbackGateway(request, invoke));

const ORIGIN = 'https://gremlin.example';

function mcpRequest(body: unknown, method: string, name?: string): Request {
  const headers: Record<string, string> = {
    authorization: 'Bearer github-oauth-token',
    'content-type': 'application/json',
    'mcp-protocol-version': MCP_PROTOCOL_VERSION,
    'mcp-method': method,
  };
  if (name) headers['mcp-name'] = name;
  return new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  return await request.json() as Record<string, unknown>;
}

function operatorAuthResponse(): Response {
  return Response.json({ ok: true, data: { login: 'trvny' } });
}

test('operator MCP lists the migrated Gremlin action names from curated OpenAPI', async () => {
  let calls = 0;
  const response = await handleOperatorMcp(
    mcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      'tools/list',
    ),
    pluginMcpOpenApi(ORIGIN),
    async (request) => {
      calls += 1;
      assert.equal(new URL(request.url).pathname, '/gpt-actions/github/read');
      assert.equal(request.method, 'POST');
      assert.deepEqual(await readJson(request), { path: '/user' });
      return operatorAuthResponse();
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  const payload = await response.json() as {
    result: {
      resultType: string;
      tools: Array<{
        name: string;
        inputSchema?: {
          required?: string[];
          properties?: Record<string, unknown>;
        };
      }>;
    };
  };
  assert.equal(payload.result.resultType, 'complete');
  assert.deepEqual(
    payload.result.tools.map((tool) => tool.name).sort(),
    [...PLUGIN_MCP_OPERATION_IDS].sort(),
  );

  const githubRead = payload.result.tools.find((tool) => tool.name === 'githubRead');
  assert.ok(githubRead);
  assert.ok(githubRead.inputSchema?.required?.includes('path'));
  assert.ok(githubRead.inputSchema?.properties?.path);
});

test('Gremlin MCP exposes only current operator, Context7 and Feedseek tools', async () => {
  const response = await handleGremlinMcp(
    mcpRequest(
      { jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} },
      'tools/list',
    ),
    pluginMcpOpenApi(ORIGIN),
    {},
    async (request) => {
      assert.equal(new URL(request.url).pathname, '/gpt-actions/github/read');
      assert.deepEqual(await readJson(request), { path: '/user' });
      return operatorAuthResponse();
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    result: { tools: Array<{ name: string }> };
  };
  const names = payload.result.tools.map((tool) => tool.name);
  assert.equal(names.length, 32);
  for (const name of PLUGIN_MCP_OPERATION_IDS) assert.ok(names.includes(name), name);
  for (const name of [
    'context7_search',
    'feedseek_search',
    'feedseek_fetch',
    'feedseek_recent',
  ]) {
    assert.ok(names.includes(name), name);
  }
  for (const excluded of [
    'engram_status', 'engram_search', 'engram_store',
    'searchEngramMemory', 'storeEngramMemory',
  ]) {
    assert.equal(names.includes(excluded), false, excluded);
  }
  assert.equal(names.includes('useGremlinStorage'), false);
});

test('Gremlin MCP rejects a call to the removed Engram provider', async () => {
  let authCalls = 0;
  const response = await handleGremlinMcp(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'engram_status', arguments: {} },
      },
      'tools/call',
      'engram_status',
    ),
    pluginMcpOpenApi(ORIGIN),
    {},
    async (request) => {
      authCalls += 1;
      assert.equal(new URL(request.url).pathname, '/gpt-actions/github/read');
      assert.deepEqual(await readJson(request), { path: '/user' });
      return operatorAuthResponse();
    },
  );

  assert.ok(response);
  assert.equal(authCalls, 1);
  const payload = await response.json() as {
    error: { code: number; message: string };
  };
  assert.equal(payload.error.code, -32602);
  assert.equal(payload.error.message, 'Unknown tool');
});

test('operator MCP dispatches githubRead through the guarded Action route', async () => {
  let calls = 0;
  const response = await handleOperatorMcp(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'githubRead',
          arguments: { path: '/repos/trvny/trvny' },
        },
      },
      'tools/call',
      'githubRead',
    ),
    pluginMcpOpenApi(ORIGIN),
    async (request) => {
      calls += 1;
      assert.equal(request.headers.get('authorization'), 'Bearer github-oauth-token');
      if (calls === 1) {
        assert.equal(new URL(request.url).pathname, '/gpt-actions/github/read');
        assert.deepEqual(await readJson(request), { path: '/user' });
        return operatorAuthResponse();
      }

      assert.equal(new URL(request.url).pathname, '/gpt-actions/github/read');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('mcp-name'), null);
      assert.equal(request.headers.get('mcp-method'), null);
      assert.equal(request.headers.get('mcp-protocol-version'), null);
      assert.deepEqual(await readJson(request), { path: '/repos/trvny/trvny' });
      return Response.json({
        ok: true,
        data: { full_name: 'trvny/trvny', default_branch: 'main' },
      });
    },
  );

  assert.ok(response);
  assert.equal(calls, 2);
  const payload = await response.json() as {
    result: {
      resultType: string;
      isError: boolean;
      structuredContent: {
        ok: boolean;
        data: { full_name: string };
      };
    };
  };
  assert.equal(payload.result.resultType, 'complete');
  assert.equal(payload.result.isError, false);
  assert.equal(payload.result.structuredContent.ok, true);
  assert.equal(payload.result.structuredContent.data.full_name, 'trvny/trvny');
});

test('operator MCP preserves GET semantics for capability inspection', async () => {
  let calls = 0;
  const response = await handleOperatorMcp(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'getOperatorCapabilities', arguments: {} },
      },
      'tools/call',
      'getOperatorCapabilities',
    ),
    pluginMcpOpenApi(ORIGIN),
    async (request) => {
      calls += 1;
      if (calls === 1) return operatorAuthResponse();
      assert.equal(request.method, 'GET');
      assert.equal(new URL(request.url).pathname, '/gpt-actions/operator/capabilities');
      return Response.json({ ok: true, service: 'gremlin' });
    },
  );

  assert.ok(response);
  assert.equal(calls, 2);
  const payload = await response.json() as {
    result: { isError: boolean; structuredContent: { ok: boolean } };
  };
  assert.equal(payload.result.isError, false);
  assert.equal(payload.result.structuredContent.ok, true);
});

test('operator MCP reports Action failures without replaying or hiding them', async () => {
  let calls = 0;
  const response = await handleOperatorMcp(
    mcpRequest(
      {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'githubRead',
          arguments: { path: '/repos/trvny/missing' },
        },
      },
      'tools/call',
      'githubRead',
    ),
    pluginMcpOpenApi(ORIGIN),
    async () => {
      calls += 1;
      if (calls === 1) return operatorAuthResponse();
      return Response.json(
        { ok: false, error: 'github_http_404' },
        { status: 404 },
      );
    },
  );

  assert.ok(response);
  assert.equal(calls, 2);
  const payload = await response.json() as {
    result: {
      isError: boolean;
      structuredContent: { ok: boolean; error: string };
    };
  };
  assert.equal(payload.result.isError, true);
  assert.equal(payload.result.structuredContent.ok, false);
  assert.equal(payload.result.structuredContent.error, 'github_http_404');
});

test('operator MCP serializes batched tool calls so writes cannot overlap', async () => {
  let active = 0;
  let maxActive = 0;
  const seen: string[] = [];

  const response = await handleOperatorMcp(
    mcpRequest(
      [
        {
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: {
            name: 'githubRead',
            arguments: { path: '/repos/trvny/one' },
          },
        },
        {
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'githubRead',
            arguments: { path: '/repos/trvny/two' },
          },
        },
      ],
      'tools/call',
    ),
    pluginMcpOpenApi(ORIGIN),
    async (request) => {
      const body = await readJson(request);
      if (body.path === '/user') return operatorAuthResponse();

      active += 1;
      maxActive = Math.max(maxActive, active);
      seen.push(String(body.path));
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return Response.json({ ok: true, data: { path: body.path } });
    },
  );

  assert.ok(response);
  assert.equal(response.status, 200);
  assert.equal(maxActive, 1);
  assert.deepEqual(seen, ['/repos/trvny/one', '/repos/trvny/two']);
});

