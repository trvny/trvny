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

test('standalone Gremlin router owns GPT Actions traffic', async () => {
  const response = await gremlinRouter.fetch(
    new Request('https://example.test/gpt-actions/github/read', { method: 'POST' }),
    {} as GremlinRouterEnv,
  );
  assert.equal(response?.status, 401);
});
