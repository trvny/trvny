import assert from 'node:assert/strict';
import test from 'node:test';

import gremlinRouter, { type GremlinRouterEnv } from '../src/gremlin-router.ts';

test('standalone Gremlin router declines non-operator traffic', async () => {
  const response = await gremlinRouter.fetch(
    new Request('https://example.test/health'),
    {} as GremlinRouterEnv,
  );
  assert.equal(response, null);
});

test('standalone Gremlin router owns GPT Actions traffic', async () => {
  const response = await gremlinRouter.fetch(
    new Request('https://example.test/gpt-actions/github/read', { method: 'POST' }),
    {} as GremlinRouterEnv,
  );
  assert.equal(response?.status, 401);
});
