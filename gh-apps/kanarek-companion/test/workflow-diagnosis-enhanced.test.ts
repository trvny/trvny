import assert from 'node:assert/strict';
import test from 'node:test';

import { failureFocusedLogExcerpt } from '../src/workflow-diagnosis-enhanced.ts';

test('failure-focused excerpts keep error windows and the tail', () => {
  const prefix = Array.from({ length: 180 }, (_, index) => `setup line ${index}`);
  const failure = [
    'build step',
    'src/example.ts(42,3): error TS2322: Type string is not assignable to number',
    'stack detail',
  ];
  const tail = Array.from({ length: 70 }, (_, index) => `tail line ${index}`);
  const result = failureFocusedLogExcerpt([...prefix, ...failure, ...tail].join('\n'));

  assert.equal(result.strategy, 'failure-signals-plus-tail');
  assert.ok(result.matchedSignals >= 1);
  assert.match(result.excerpt, /TS2322/);
  assert.match(result.excerpt, /tail line 69/);
  assert.doesNotMatch(result.excerpt, /setup line 0\n/);
  assert.equal(result.truncated, true);
});

test('logs without failure signals fall back to the final lines', () => {
  const lines = Array.from({ length: 220 }, (_, index) => `ordinary output ${index}`);
  const result = failureFocusedLogExcerpt(lines.join('\n'));

  assert.equal(result.strategy, 'tail-only');
  assert.equal(result.matchedSignals, 0);
  assert.match(result.excerpt, /ordinary output 219/);
  assert.doesNotMatch(result.excerpt, /ordinary output 0\n/);
  assert.ok(result.selectedLineCount <= 100);
});

test('excerpt length stays bounded while preserving the end of the failure', () => {
  const text = `${'noise\n'.repeat(300)}Error: ${'x'.repeat(20_000)}\nfinal marker`;
  const result = failureFocusedLogExcerpt(text, 2_000);

  assert.ok(result.excerpt.length <= 2_002);
  assert.match(result.excerpt, /final marker$/);
  assert.equal(result.truncated, true);
});
