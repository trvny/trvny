import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { authorized, secretsMatch, type Env } from '../src/index.ts';
import { allowedOwner } from '../src/github.ts';

const TOKEN = 'a'.repeat(32);
const env: Env = { CLAUDIUSZ_APP_ID: '4454097', ALLOWED_OWNERS: 'trvny, travnie', CLAUDIUSZ_MCP_TOKEN: TOKEN };

function rpc(body: unknown, path = `/${TOKEN}`): Request {
  return new Request(`https://claudiusz-mcp.test${path}`, { method: 'POST', body: JSON.stringify(body) });
}

async function call(body: unknown, e: Env = env) {
  const response = await worker.fetch(rpc(body), e);
  return { status: response.status, body: (await response.json()) as any };
}

test('secretsMatch compares whole strings', () => {
  assert.equal(secretsMatch('abc', 'abc'), true);
  assert.equal(secretsMatch('abc', 'abd'), false);
  assert.equal(secretsMatch('abc', 'abcd'), false);
});

test('auth accepts path or bearer and fails closed without a token', () => {
  assert.equal(authorized(rpc({}), env), true);
  assert.equal(authorized(rpc({}, '/wrong'), env), false);
  const bearer = new Request('https://x.test/', { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(authorized(bearer, env), true);
  assert.equal(authorized(rpc({}), { ...env, CLAUDIUSZ_MCP_TOKEN: undefined }), false);
});

test('unauthorized POST is rejected with 401', async () => {
  const response = await worker.fetch(rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, '/nope'), env);
  assert.equal(response.status, 401);
});

test('owner allowlist is case-insensitive and exact', () => {
  assert.equal(allowedOwner(env, 'TRVNY'), true);
  assert.equal(allowedOwner(env, 'travnie'), true);
  assert.equal(allowedOwner(env, 'trvny-evil'), false);
});

test('initialize negotiates a supported protocol version', async () => {
  const known = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(known.body.result.protocolVersion, '2025-06-18');
  assert.equal(known.body.result.serverInfo.icons[0].src, 'https://claudiusz-mcp.test/icon.png');
  const unknown = await call({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.equal(unknown.body.result.protocolVersion, '2025-11-25');
});

test('tools/list exposes the write tools', async () => {
  const { body } = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const names = body.result.tools.map((tool: { name: string }) => tool.name);
  for (const name of ['whoami', 'comment', 'react', 'reply_review_comment', 'review', 'resolve_thread']) {
    assert.ok(names.includes(name), name);
  }
});

test('tool calls fail cleanly without the private key', async () => {
  const { body } = await call({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'comment', arguments: { owner: 'trvny', repo: 'trvny', number: 1, body: 'hi' } },
  });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /GH_APP_PRIVATE_KEY/);
});

test('disallowed owners are refused before any GitHub call', async () => {
  const { body } = await call({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'comment', arguments: { owner: 'someone', repo: 'x', number: 1, body: 'hi' } },
  });
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /owner not allowed/);
});

test('notifications get 202 with no body', async () => {
  const response = await worker.fetch(rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), env);
  assert.equal(response.status, 202);
});
