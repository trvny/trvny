import assert from 'node:assert/strict';
import test from 'node:test';

import { unauthenticatedMcpFallback } from '../src/mcp-fallback.ts';

const ORIGIN = 'https://gremlin.travny.workers.dev';

test('legacy GitHub bearer cannot bypass OAuth to call MCP', async () => {
  for (const authorization of [undefined, 'Bearer ghu_old-github-user-token', 'Bearer wrong-resource-token']) {
    const headers = new Headers({ 'Content-Type': 'application/json' });
    if (authorization) headers.set('Authorization', authorization);
    const request = new Request(ORIGIN + '/mcp', {
      method: 'POST',
      headers,
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    });
    const result = unauthenticatedMcpFallback(request, ORIGIN);
    assert.ok(result);
    assert.equal(result.status, 401);
    assert.match(result.headers.get('WWW-Authenticate') ?? '', /Bearer resource_metadata="/);
    assert.equal((await result.json() as { error: string }).error, 'unauthorized');
  }
});

test('MCP preflight is not interpreted as an authenticated tools request', () => {
  const result = unauthenticatedMcpFallback(new Request(ORIGIN + '/mcp', { method: 'OPTIONS' }), ORIGIN);
  assert.ok(result);
  assert.equal(result.status, 204);
  assert.equal(result.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
});

test('compatibility Actions are still routed separately', () => {
  const result = unauthenticatedMcpFallback(new Request(ORIGIN + '/gpt-actions/github/read'), ORIGIN);
  assert.equal(result, null);
});
