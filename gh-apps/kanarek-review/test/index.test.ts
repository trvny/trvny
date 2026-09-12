import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { reviewEnvForRequest } from '../src/index.ts';
import { REVIEW_WORKERS_AI_OVERRIDE_HEADER } from '../../kanarek-companion/src/review-router.ts';

test('review worker applies the per-request Workers AI retry override', () => {
  const env = { KANAREK_REVIEW_WORKERS_AI_ENABLED: 'true' };
  const request = new Request('https://kanarek-review.internal/review-router/v1/models', {
    headers: { [REVIEW_WORKERS_AI_OVERRIDE_HEADER]: 'false' },
  });

  const effective = reviewEnvForRequest(request, env);
  assert.notEqual(effective, env);
  assert.equal(effective.KANAREK_REVIEW_WORKERS_AI_ENABLED, 'false');
  assert.equal(env.KANAREK_REVIEW_WORKERS_AI_ENABLED, 'true');
});

test('review worker health is explicit when no providers are configured', async () => {
  const response = await worker.fetch(
    new Request('https://kanarek-review.internal/health'),
    {},
  );
  assert.equal(response.status, 503);
  const body = await response.json() as { service?: string; ok?: boolean };
  assert.equal(body.service, 'kanarek-review');
  assert.equal(body.ok, false);
});
