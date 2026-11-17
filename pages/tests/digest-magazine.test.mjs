import test from 'node:test';
import assert from 'node:assert/strict';
import { isHttpsUrl, isDigestMediaUrl, chartMax } from '../astro/src/lib/digest-magazine.mjs';

test('digest links reject unsafe protocols, credentials and ambiguous paths', () => {
  for (const value of ['http://example.org', 'javascript:alert(1)', '//example.org/a', 'https://user:pass@example.org', 'https://example.org\\a', 'https://example.org/a b']) {
    assert.equal(isHttpsUrl(value), false, value);
  }
  assert.equal(isHttpsUrl('https://example.org/story?q=1'), true);
});

test('digest media allows dedicated assets and HTTPS only', () => {
  assert.equal(isDigestMediaUrl('/assets/digest/meme.svg'), true);
  assert.equal(isDigestMediaUrl('https://example.org/clip.mp4'), true);
  for (const value of ['/assets/digest/../other.svg', '/assets/digest/%2e%2e.svg', '/assets/digest/a.html', 'data:image/svg+xml,x', '//example.org/a.png']) {
    assert.equal(isDigestMediaUrl(value), false, value);
  }
});

test('chart has nonzero scale even for all-zero data', () => {
  assert.equal(chartMax([{ value: 0 }]), 1);
  assert.equal(chartMax([{ value: 2 }, { value: 10 }]), 10);
});
