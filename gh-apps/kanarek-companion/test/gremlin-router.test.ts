import assert from 'node:assert/strict';
import test from 'node:test';

import gremlinRouter, { type GremlinRouterEnv } from '../src/operator/gremlin-router.ts';

test('standalone Gremlin router declines non-operator traffic', async () => {
  for (const path of [
    '/',
    '/health',
    '/mcp',
    '/webhooks/github',
    '/gptomek/wake',
    '/review-router/v1/chat/completions',
    '/gpt-actions-extra/github/read',
    '/gpt-action/github/read',
  ]) {
    const response = await gremlinRouter.fetch(
      new Request(`https://example.test${path}`, { method: 'POST' }),
      {} as GremlinRouterEnv,
    );
    assert.equal(response, null, path);
  }
});

test('non-operator traffic does not enter the operator handler chain', async () => {
  let urlReads = 0;
  const request = new Proxy(new Request('https://example.test/gpt-actions-extra/health'), {
    get(target, property) {
      if (property === 'url') urlReads += 1;
      return Reflect.get(target, property, target);
    },
  });

  const response = await gremlinRouter.fetch(request, {} as GremlinRouterEnv);
  assert.equal(response, null);
  assert.equal(urlReads, 1, 'route handlers must not inspect a non-operator request');
});

test('exact GPT Actions root remains claimed by the operator router', async () => {
  const response = await gremlinRouter.fetch(
    new Request('https://example.test/gpt-actions', { method: 'POST' }),
    {} as GremlinRouterEnv,
  );
  assert.ok(response, 'the operator route must not fall through to companion');
});

test('standalone Gremlin router owns GPT Actions traffic', async () => {
  const response = await gremlinRouter.fetch(
    new Request('https://example.test/gpt-actions/github/read', { method: 'POST' }),
    {} as GremlinRouterEnv,
  );
  assert.equal(response?.status, 401);
});
