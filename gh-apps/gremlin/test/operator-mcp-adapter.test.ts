import assert from 'node:assert/strict';
import test from 'node:test';

import {
  combineMcpSurfaces,
  githubGateway,
  handleMcp,
  MCP_PROTOCOL_VERSION,
  scopedRuntimeOpenApi,
  selectedSpecialistSurface,
  type ActionInvoke,
  type JsonObject,
} from 'kanarek-companion/runtime';
import { GREMLIN_SPECIALIST_TOOL_NAMES as scopedFeedseek } from '../src/mcp-runtime.ts';
import { operatorSurface } from '../src/operator-mcp-surface.ts';

type Invoke = ActionInvoke;

// Test-only gateway for the existing route-shaped authorization fixtures.
function loopbackGateway(source: Request, invoke: Invoke): ReturnType<typeof githubGateway> {
  const unsupported = async () => { throw new Error('unexpected gateway call'); };
  return {
    async read(path) {
      const response = await invoke(new Request(new URL('/gpt-actions/github/read', source.url), {
        method: 'POST',
        headers: source.headers,
        body: JSON.stringify({ path }),
      }));
      assert.ok(response.ok);
      const payload = await response.json() as { ok: boolean; data: unknown };
      assert.equal(payload.ok, true);
      return payload.data;
    },
    readOptional: unsupported,
    graphql: unsupported,
    bot: unsupported,
    botEmpty: unsupported,
  };
}

function handleGremlinMcp(
  request: Request,
  document: JsonObject,
  env: Parameters<typeof selectedSpecialistSurface>[0],
  invoke: Invoke,
  fetcher: typeof fetch = fetch,
) {
  return handleMcp(request, loopbackGateway(request, invoke), combineMcpSurfaces(
    operatorSurface(request, document, invoke),
    selectedSpecialistSurface(env, fetcher, scopedFeedseek),
    'Fixture scoped MCP surface.',
  ));
}

function handleOperatorMcp(request: Request, document: JsonObject, invoke: Invoke) {
  return handleMcp(request, loopbackGateway(request, invoke), operatorSurface(request, document, invoke));
}

const ORIGIN = 'https://gremlin.example';
const SELECTED_OPERATOR_IDS = ['getRepositoryContext', 'getOperatorCapabilities'] as const;

function selectedOperatorOpenApi(): Record<string, unknown> {
  return scopedRuntimeOpenApi(ORIGIN, SELECTED_OPERATOR_IDS);
}

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

test('operator MCP lists selected Actions from scoped OpenAPI', async () => {
  let calls = 0;
  const response = await handleOperatorMcp(
    mcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      'tools/list',
    ),
    selectedOperatorOpenApi(),
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
    [...SELECTED_OPERATOR_IDS].sort(),
  );

  const context = payload.result.tools.find((tool) => tool.name === 'getRepositoryContext');
  assert.ok(context);
  assert.ok(context.inputSchema?.required?.includes('repository'));
  assert.ok(context.inputSchema?.properties?.repository);
  assert.equal(payload.result.tools.some((tool) => tool.name === 'githubRead'), false);
});

test('scoped MCP exposes only selected operators and Feedseek specialists', async () => {
  const response = await handleGremlinMcp(
    mcpRequest(
      { jsonrpc: '2.0', id: 10, method: 'tools/list', params: {} },
      'tools/list',
    ),
    selectedOperatorOpenApi(),
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
  assert.equal(names.length, SELECTED_OPERATOR_IDS.length + scopedFeedseek.length);
  for (const name of SELECTED_OPERATOR_IDS) assert.ok(names.includes(name), name);
  for (const name of [
    'feedseek_search',
    'feedseek_fetch',
    'feedseek_recent',
  ]) {
    assert.ok(names.includes(name), name);
  }
  for (const excluded of [
    'engram_status', 'engram_search', 'engram_store', 'context7_search',
    'searchEngramMemory', 'storeEngramMemory', 'githubRead', 'getDoc',
    'getDocsIndex', 'searchDocs', 'searchContext7Docs', 'getCloudflareOverview',
    'createPullRequestAsTrvny', 'searchFeedseek', 'fetchFeedseekEntry',
    'getRecentFeedseekEntries',
  ]) {
    assert.equal(names.includes(excluded), false, excluded);
  }
  assert.equal(names.includes('useGremlinStorage'), false);
});

test('scoped MCP rejects calls to unselected Engram tools', async () => {
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
    selectedOperatorOpenApi(),
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
    scopedRuntimeOpenApi(ORIGIN, ['githubRead']),
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
    selectedOperatorOpenApi(),
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
    scopedRuntimeOpenApi(ORIGIN, ['githubRead']),
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
    scopedRuntimeOpenApi(ORIGIN, ['githubRead']),
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

