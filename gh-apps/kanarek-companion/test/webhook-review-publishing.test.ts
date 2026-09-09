import assert from 'node:assert/strict';
import test from 'node:test';

import {
  reviewDisposition,
  reviewMarker,
  reviewSourceLabel,
  submittedReviewMatches,
} from '../src/webhook-review.ts';

test('review source label includes provider and concrete upstream model', () => {
  assert.equal(
    reviewSourceLabel('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free'),
    'OpenRouter · `nvidia/nemotron-3-ultra-550b-a55b:free`',
  );
  assert.equal(
    reviewSourceLabel('aihubmix', 'deepseek-v4-flash-ga-260731'),
    'AIHubMix · `deepseek-v4-flash-ga-260731`',
  );
});

test('review source label falls back to the provider when model is unavailable', () => {
  assert.equal(reviewSourceLabel('openrouter', null), 'OpenRouter');
  assert.equal(reviewSourceLabel('workers-ai', null), 'Workers AI');
});

test('review deduplication recognizes the GPTomek publisher', () => {
  const target = {
    action: 'synchronize',
    baseSha: 'b'.repeat(40),
    delivery: 'delivery-1',
    headSha: 'a'.repeat(40),
    installationId: 123,
    number: 21,
    repository: 'twojstar/llmbench',
  };
  assert.equal(
    submittedReviewMatches(
      {
        body: `${reviewMarker(target)}\nreview`,
        commit_id: target.headSha,
        user: { login: 'gptomek[bot]' },
      },
      target,
    ),
    true,
  );
});

test('only genuinely clean reviews stay silent', () => {
  assert.equal(reviewDisposition([], []), 'clean');
  assert.equal(reviewDisposition([{}], []), 'invalid_findings');
  assert.equal(reviewDisposition([{}], [{}]), 'publish');
});
