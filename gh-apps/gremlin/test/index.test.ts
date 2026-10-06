import assert from 'node:assert/strict';
import test from 'node:test';

import { gremlinMcpManifest } from 'kanarek-companion/runtime';
import worker from '../src/index.ts';

const ORIGIN = 'https://gremlin.internal';

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

test('Gremlin owns the full migrated MCP surface', async () => {
  const manifest = gremlinMcpManifest(ORIGIN) as { toolNames?: string[] };
  assert.equal(manifest.toolNames?.length, 37);
  assert.ok(manifest.toolNames?.includes('getDocsIndex'));
  assert.ok(manifest.toolNames?.includes('implementCodeChange'));
  assert.ok(manifest.toolNames?.includes('engram_search'));
  assert.ok(manifest.toolNames?.includes('context7_search'));
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

test('Gremlin worker serves the full runtime action surface', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/gpt-actions/openapi.json`), {} as never);
  assert.equal(response.status, 200);
  const document = await response.json() as { servers?: Array<{ url?: string }>; paths?: Record<string, unknown> };
  assert.equal(document.servers?.[0]?.url, ORIGIN);
  // Runtime-level operation, not part of the bare gremlin-router surface.
  assert.ok(document.paths?.['/gpt-actions/operator/code-review']);
});
