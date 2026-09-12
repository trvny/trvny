import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { reviewEnvForRequest } from '../src/index.ts';
import {
  REVIEW_SERVICE_INTERNAL_BEARER,
  REVIEW_SERVICE_TRUST_HEADER,
  REVIEW_SERVICE_TRUST_VALUE,
} from '../../kanarek-companion/src/review-service-protocol.ts';
import { REVIEW_WORKERS_AI_OVERRIDE_HEADER } from '../../kanarek-companion/src/review-router.ts';

test('review worker applies the per-request Workers AI retry override', () => {
  const env = { KANAREK_REVIEW_WORKERS_AI_ENABLED: 'true' };
  const request = new Request('https://kanarek-review.internal/review-router/v1/models', {
    headers: {
      Authorization: `Bearer ${REVIEW_SERVICE_INTERNAL_BEARER}`,
      [REVIEW_SERVICE_TRUST_HEADER]: REVIEW_SERVICE_TRUST_VALUE,
      [REVIEW_WORKERS_AI_OVERRIDE_HEADER]: 'false',
    },
  });

  const effective = reviewEnvForRequest(request, env);
  assert.notEqual(effective, env);
  assert.equal(effective.KANAREK_REVIEW_WORKERS_AI_ENABLED, 'false');
  assert.equal(effective.KANAREK_REVIEW_ROUTER_TOKEN, REVIEW_SERVICE_INTERNAL_BEARER);
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


test('review worker accepts router calls only from the trusted service protocol', async () => {
  const trusted = await worker.fetch(
    new Request('https://kanarek-review.internal/review-router/v1/models', {
      headers: {
        Authorization: `Bearer ${REVIEW_SERVICE_INTERNAL_BEARER}`,
        [REVIEW_SERVICE_TRUST_HEADER]: REVIEW_SERVICE_TRUST_VALUE,
      },
    }),
    {},
  );
  assert.equal(trusted.status, 200);

  const direct = await worker.fetch(
    new Request('https://kanarek-review.internal/review-router/v1/models', {
      headers: { Authorization: 'Bearer copied-external-token' },
    }),
    { KANAREK_REVIEW_ROUTER_TOKEN: 'copied-external-token' },
  );
  assert.equal(direct.status, 401);
});
