import assert from 'node:assert/strict';
import test from 'node:test';

import { anchorStorageOpenApi } from '../src/anchor-storage.ts';
import { gatewayManifest, gatewayOpenApi } from '../src/entry.ts';

test('gateway OpenAPI exposes live capability and specialist actions', () => {
  const document = gatewayOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string; description?: string }>>;
  };
  const operations = Object.values(document.paths).flatMap((path) => Object.values(path));
  const capability = operations.find(
    (operation) => operation.operationId === 'getOperatorCapabilities',
  );
  const smoke = operations.find(
    (operation) => operation.operationId === 'runOperatorSmokeTest',
  );
  const context7 = operations.find(
    (operation) => operation.operationId === 'searchContext7Docs',
  );
  const storage = operations.find(
    (operation) => operation.operationId === 'useGremlinStorage',
  );
  const feedseek = operations.filter(
    (operation) => operation.operationId?.includes('Feedseek'),
  );

  assert.ok(capability);
  assert.ok(smoke);
  assert.ok(context7);
  assert.equal(storage, undefined);
  assert.deepEqual(
    feedseek.map((operation) => operation.operationId).sort(),
    ['fetchFeedseekEntry', 'getRecentFeedseekEntries', 'searchFeedseek'],
  );
  assert.ok(!capability.description || capability.description.length <= 300);
  assert.ok(!smoke.description || smoke.description.length <= 300);

  const anchor = anchorStorageOpenApi('https://example.workers.dev') as {
    paths: Record<string, Record<string, { operationId?: string }>>;
  };
  const anchorOperations = Object.values(anchor.paths).flatMap((path) => Object.values(path));
  assert.deepEqual(anchorOperations.map((operation) => operation.operationId), ['useGremlinStorage']);
});

test('gateway manifest reports exact operation IDs, separate Anchor Action and Worker metadata', async () => {
  const document = gatewayOpenApi('https://example.workers.dev');
  const manifest = await gatewayManifest(document, {
    id: 'worker-version-id',
    tag: 'deploy-tag',
    timestamp: '2026-08-21T00:00:00.000Z',
  }) as {
    manifestVersion: number;
    service: string;
    runtimeRole: string;
    subsystems: string[];
    workerVersion: { id: string; tag: string; timestamp: string };
    openApi: {
      operationCount: number;
      operationIds: string[];
      capabilityDigest: string;
    };
    anchorAction: {
      path: string;
      operationIds: string[];
      authentication: string;
    };
    mcp: {
      path: string;
      protocolVersion: string;
      stateless: boolean;
      toolNames: string[];
    };
  };

  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.service, 'kanarek-companion');
  assert.equal(manifest.runtimeRole, 'shared-automation-worker');
  assert.deepEqual(manifest.subsystems, [
    'kanarek-companion',
    'gptomek-bridge',
    'gremlin-operator',
    'specialist-intelligence',
    'gremlin-storage',
  ]);
  assert.equal(manifest.workerVersion.id, 'worker-version-id');
  assert.equal(manifest.workerVersion.tag, 'deploy-tag');
  assert.ok(manifest.openApi.operationIds.includes('getOperatorCapabilities'));
  assert.ok(manifest.openApi.operationIds.includes('getCloudflareOverview'));
  assert.ok(!manifest.openApi.operationIds.includes('useGremlinStorage'));
  assert.ok(manifest.openApi.operationIds.includes('searchContext7Docs'));
  assert.ok(manifest.openApi.operationIds.includes('searchFeedseek'));
  assert.ok(manifest.openApi.operationIds.includes('fetchFeedseekEntry'));
  assert.ok(manifest.openApi.operationIds.includes('getRecentFeedseekEntries'));
  assert.ok(manifest.openApi.operationIds.includes('runOperatorSmokeTest'));
  assert.ok(manifest.openApi.operationIds.includes('runOperatorAutopilot'));
  assert.ok(manifest.openApi.operationIds.includes('orchestrateRelease'));
  assert.equal(manifest.openApi.operationCount, manifest.openApi.operationIds.length);
  assert.match(manifest.openApi.capabilityDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    manifest.openApi.operationIds,
    [...manifest.openApi.operationIds].sort(),
  );
  assert.equal(manifest.anchorAction.path, '/gpt-actions/anchor/openapi.json');
  assert.deepEqual(manifest.anchorAction.operationIds, ['useGremlinStorage']);
  assert.equal(manifest.anchorAction.authentication, 'anchor-oauth');
  assert.equal(manifest.mcp.path, '/mcp');
  assert.equal(manifest.mcp.protocolVersion, '2026-07-28');
  assert.equal(manifest.mcp.stateless, true);
  assert.deepEqual(
    manifest.mcp.toolNames.sort(),
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
