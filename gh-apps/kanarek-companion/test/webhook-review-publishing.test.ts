import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reviewSourceLabel,
  shouldPublishReview,
} from '../src/webhook-review.ts';

test('review source label prefers the concrete upstream model', () => {
  assert.equal(
    reviewSourceLabel('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free'),
    '`nvidia/nemotron-3-ultra-550b-a55b:free`',
  );
});

test('review source label falls back to the provider when model is unavailable', () => {
  assert.equal(reviewSourceLabel('openrouter', null), 'OpenRouter');
});

test('clean reviews stay silent', () => {
  assert.equal(shouldPublishReview([]), false);
  assert.equal(shouldPublishReview([{}]), true);
});
