import assert from 'node:assert/strict';
import test from 'node:test';

import { blockerKinds, status } from '../src/companion.ts';

const calculating = {
  base: { ref: 'main', sha: 'a'.repeat(40) },
  draft: false,
  mergeable: null,
  mergeable_state: 'unknown',
  merged: false,
  state: 'open',
};
const ci = { failed: [], passed: [{}], pending: [], total: 1 };
const review = { approvals: 0, changes: 0 };

test('keeps unknown mergeability conservative while GitHub recalculates', () => {
  assert.equal(status(calculating, { behind: 0 }, ci, review).key, 'waiting');
  assert.deepEqual(
    blockerKinds(calculating, { behind: 0 }, ci, review),
    ['mergeability-pending'],
  );
});
