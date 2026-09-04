import assert from 'node:assert/strict';
import test from 'node:test';

import { gatewayManifest, gatewayOpenApi } from '../src/entry.ts';

test('gateway OpenAPI exposes live capability and smoke actions', () => {
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

  assert.ok(capability);
  assert.ok(smoke);
  assert.ok(!capability.description || capability.description.length <= 300);
  assert.ok(!smoke.description || smoke.description.length <= 300);
});

test('gateway manifest reports exact operation IDs and Worker version metadata', async () => {
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
  };

  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.service, 'kanarek-companion');
  assert.equal(manifest.runtimeRole, 'shared-automation-worker');
  assert.deepEqual(manifest.subsystems, [
    'kanarek-companion',
    'gptomek-bridge',
    'gremlin-operator',
    'specialist-intelligence',
  ]);
  assert.equal(manifest.workerVersion.id, 'worker-version-id');
  assert.equal(manifest.workerVersion.tag, 'deploy-tag');
  assert.ok(manifest.openApi.operationIds.includes('getOperatorCapabilities'));
  assert.ok(manifest.openApi.operationIds.includes('getCloudflareOverview'));
  assert.ok(manifest.openApi.operationIds.includes('runOperatorSmokeTest'));
  assert.ok(manifest.openApi.operationIds.includes('runOperatorAutopilot'));
  assert.ok(manifest.openApi.operationIds.includes('orchestrateRelease'));
  assert.equal(manifest.openApi.operationCount, manifest.openApi.operationIds.length);
  assert.match(manifest.openApi.capabilityDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(
    manifest.openApi.operationIds,
    [...manifest.openApi.operationIds].sort(),
  );
});
