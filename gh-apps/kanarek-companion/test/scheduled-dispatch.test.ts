import assert from 'node:assert/strict';
import test from 'node:test';
import { SHITPOST_DISPATCH_CRON, warsawHour } from '../src/operator/scheduled-dispatch.ts';

test('shitpost dispatch cron hits 04:20 Warsaw exactly once across DST', () => {
  const firings = (day: string) =>
    ['02:20', '03:20'].map((t) => warsawHour(Date.parse(`${day}T${t}:00Z`)));
  // CEST (UTC+2): 02:20 UTC is 04:20 local.
  assert.deepEqual(firings('2026-07-01'), [4, 5]);
  // CET (UTC+1): 03:20 UTC is 04:20 local.
  assert.deepEqual(firings('2026-12-01'), [3, 4]);
  assert.equal(SHITPOST_DISPATCH_CRON, '20 2,3 * * *');
});
