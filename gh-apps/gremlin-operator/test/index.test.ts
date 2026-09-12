import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.ts';

test('Gremlin worker exposes private health without operator credentials', async () => {
  const response = await worker.fetch(
    new Request('https://gremlin-operator.internal/health'),
    {} as never,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as { ok?: boolean; service?: string };
  assert.equal(body.ok, true);
  assert.equal(body.service, 'gremlin-operator');
});

test('Gremlin worker rejects unrelated routes', async () => {
  const response = await worker.fetch(
    new Request('https://gremlin-operator.internal/webhooks/github'),
    {} as never,
  );
  assert.equal(response.status, 404);
});

test('Gremlin worker owns GPT Actions routes and preserves auth', async () => {
  const response = await worker.fetch(
    new Request('https://gremlin-operator.internal/gpt-actions/github/read', { method: 'POST' }),
    {} as never,
  );
  assert.equal(response.status, 401);
});
