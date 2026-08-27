import assert from 'node:assert/strict';
import test from 'node:test';

import { nextFreeReviewProvider } from '../src/free-review-job.ts';

test('moves provider failures from OrcaRouter to a separate OpenRouter alarm', () => {
  assert.equal(
    nextFreeReviewProvider('orcarouter', {
      reviewed: false,
      provider: null,
      findingCount: 0,
      skipped: 'provider_failed',
    }),
    'openrouter',
  );
});

test('does not chain another alarm after OpenRouter or non-provider skips', () => {
  assert.equal(
    nextFreeReviewProvider('openrouter', {
      reviewed: false,
      provider: null,
      findingCount: 0,
      skipped: 'provider_failed',
    }),
    null,
  );
  assert.equal(
    nextFreeReviewProvider('orcarouter', {
      reviewed: false,
      provider: null,
      findingCount: 0,
      skipped: 'stale_head',
    }),
    null,
  );
});
