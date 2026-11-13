import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  GREMLIN_MCP_OPERATION_IDS,
  GREMLIN_SPECIALIST_TOOL_NAMES,
  gremlinGatewayManifest,
  gremlinMcpManifest,
} from '../src/mcp-runtime.ts';
import worker from '../src/index.ts';

const ORIGIN = 'https://gremlin.internal';

const EXPECTED_GREMLIN_OPERATORS = [
  'getOperatorBootstrap',
  'getGremlinKnowledge',
  'inspectPackage',
  'getOperatorCapabilities',
  'runOperatorSmokeTest',
  'runOperatorAutopilot',
  'getAccountMaintenance',
  'runAccountMaintenanceAutofix',
  'getRepositoryContext',
  'prepareChange',
  'implementCodeChange',
  'investigateCode',
  'reviewCodeChange',
  'inspectPullRequest',
  'finalizePullRequest',
  'orchestrateRelease',
  'diagnoseWorkflowRun',
  'githubBotRequest',
] as const;

test('Gremlin worker exposes private health without operator credentials', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/health`), {} as never);
  assert.equal(response.status, 200);
  const body = await response.json() as { ok?: boolean; service?: string };
  assert.equal(body.ok, true);
  assert.equal(body.service, 'gremlin');
});

test('Gremlin worker rejects Kanarek-only ingress', async () => {
  for (const [path, method] of [
    ['/webhooks/github', 'POST'],
    ['/gptomek/wake', 'POST'],
    ['/review-router/v1/chat/completions', 'POST'],
    ['/review-router/v1/models', 'GET'],
  ] as const) {
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { method }), {} as never);
    assert.equal(response.status, 404, path);
  }
});

test('Gremlin worker owns GPT Actions routes and preserves auth', async () => {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/gpt-actions/github/read`, { method: 'POST' }),
    {} as never,
  );
  assert.equal(response.status, 401);
});

test('Gremlin advertises a lean, non-overlapping MCP surface', async () => {
  assert.deepEqual(GREMLIN_MCP_OPERATION_IDS, EXPECTED_GREMLIN_OPERATORS);
  assert.equal(new Set(GREMLIN_MCP_OPERATION_IDS).size, 18);
  const manifest = gremlinMcpManifest(ORIGIN) as { toolNames?: string[]; specialistToolNames?: string[] };
  assert.deepEqual(GREMLIN_SPECIALIST_TOOL_NAMES, [
    'feedseek_search', 'feedseek_fetch', 'feedseek_recent',
  ]);
  assert.deepEqual(manifest.specialistToolNames, [
    'feedseek_fetch', 'feedseek_recent', 'feedseek_search',
  ]);
  assert.equal(manifest.toolNames?.length, 21);
  assert.equal(manifest.toolNames?.includes('getDocsIndex'), false);
  assert.ok(manifest.toolNames?.includes('implementCodeChange'));
  for (const stale of [
    'engram_status', 'engram_search', 'engram_store',
    'searchEngramMemory', 'storeEngramMemory',
  ]) {
    assert.equal(manifest.toolNames?.includes(stale), false, stale);
  }
  assert.equal(manifest.toolNames?.includes('context7_search'), false);
  assert.ok(manifest.toolNames?.includes('feedseek_recent'));
  assert.equal(manifest.toolNames?.includes('useGremlinStorage'), false);

  const response = await worker.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-protocol-version': '2026-07-28',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    }),
    {} as never,
  );
  assert.equal(response.status, 401);
});

test('Gremlin does not expose the wrong Engram Action routes or advertise them', async () => {
  for (const path of [
    '/gpt-actions/engram/status',
    '/gpt-actions/engram/search',
    '/gpt-actions/engram/store',
  ]) {
    const response = await worker.fetch(new Request(`${ORIGIN}${path}`, { method: 'POST' }), {} as never);
    assert.equal(response.status, 404, path);
  }
  const response = await worker.fetch(
    new Request(`${ORIGIN}/gpt-actions/openapi.json`), {} as never,
  );
  assert.equal(response.status, 200);
  const document = await response.json() as { paths?: Record<string, unknown> };
  assert.equal(
    Object.keys(document.paths ?? {}).some((path) => path.startsWith('/gpt-actions/engram/')),
    false,
  );
});

test('Gremlin serves legacy GPT Actions without the obsolete Engram bridge', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/gpt-actions/openapi.json`), {} as never);
  assert.equal(response.status, 200);
  const document = await response.json() as { servers?: Array<{ url?: string }>; paths?: Record<string, unknown> };
  assert.equal(document.servers?.[0]?.url, ORIGIN);
  // Runtime-level operation, not part of the bare gremlin-router surface.
  assert.ok(document.paths?.['/gpt-actions/operator/code-review']);
  const legacyOperationIds = Object.values(document.paths ?? {}).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    return Object.values(item).flatMap((operation) =>
      operation && typeof operation === 'object' && 'operationId' in operation
        ? [String(operation.operationId)]
        : []);
  });
  // The shared legacy Builder schema has 29 operations. Gremlin intentionally
  // hides the two broken Engram Action routes, exposing 27 here.
  assert.equal(legacyOperationIds.length, 27);
  for (const legacyOnly of ['githubRead', 'getDoc', 'searchDocs']) {
    assert.ok(legacyOperationIds.includes(legacyOnly), legacyOnly);
    assert.equal(GREMLIN_MCP_OPERATION_IDS.includes(legacyOnly as never), false);
  }
  for (const disabled of ['searchEngramMemory', 'storeEngramMemory']) {
    assert.equal(legacyOperationIds.includes(disabled), false, disabled);
  }
});

// Capability and smoke metadata must reflect the curated Gremlin provider,
// not the legacy 37-tool shared gateway that still serves old GPT Actions.
test('Gremlin capability metadata hashes the same 18 operators it exposes', async () => {
  const capabilities = await gremlinGatewayManifest(ORIGIN, {
    id: 'test-worker-version',
    tag: 'test',
    timestamp: '2026-10-18T00:00:00Z',
  }) as {
    openApi: { operationIds: string[]; operationCount: number; capabilityDigest: string };
    mcp: { toolNames: string[] };
  };
  assert.equal(capabilities.openApi.operationCount, 18);
  assert.deepEqual(capabilities.openApi.operationIds, [...EXPECTED_GREMLIN_OPERATORS].sort());
  const expectedDigest = createHash('sha256')
    .update([...capabilities.openApi.operationIds].sort().join('\n'))
    .digest('hex');
  assert.equal(capabilities.openApi.capabilityDigest, `sha256:${expectedDigest}`);
  assert.equal(capabilities.mcp.toolNames.length, 21);
  for (const name of ['searchEngramMemory', 'storeEngramMemory']) {
    assert.equal(capabilities.openApi.operationIds.includes(name), false);
    assert.equal(capabilities.mcp.toolNames.includes(name), false);
  }
});
