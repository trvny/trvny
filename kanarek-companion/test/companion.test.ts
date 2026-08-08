import assert from 'node:assert/strict';
import test from 'node:test';

import { areas, blockerKinds, MARKER, render, size, status } from '../src/companion.ts';

const pr = {
  additions: 10,
  auto_merge: null,
  base: { ref: 'main', sha: 'a'.repeat(40) },
  changed_files: 2,
  deletions: 2,
  draft: false,
  head: { sha: 'b'.repeat(40) },
  mergeable: true,
  mergeable_state: 'clean',
  merged: false,
  number: 12,
  state: 'open',
};

const emptyCi = { failed: [], passed: [], pending: [], total: 0 };
const review = { approvals: 0, changes: 0 };

test('keeps missing CI as waiting by default', () => {
  const current = status(pr, { behind: 0 }, emptyCi, review, true);
  assert.equal(current.key, 'waiting');
  assert.deepEqual(
    blockerKinds(pr, { behind: 0 }, emptyCi, review, true),
    ['ci-missing'],
  );
});

test('allows CI-less repositories to become ready', () => {
  assert.equal(status(pr, { behind: 0 }, emptyCi, review, false).key, 'ready');
});

test('describes GitHub blocked merge state in quip facts', () => {
  const blocked = { ...pr, mergeable_state: 'blocked' };
  assert.deepEqual(
    blockerKinds(blocked, { behind: 0 }, { failed: [], passed: [{}], pending: [], total: 1 }, review, true),
    ['merge-state-blocked'],
  );
});

test('maps the refreshed GitHub automation signature back to Kanarek', () => {
  const projectAreas = areas(['.github/workflows/example.yml']);
  const body = render(
    pr,
    { behind: 0 },
    { failed: [], passed: [{}], pending: [], total: 1 },
    review,
    [...projectAreas, 'Kanarek'],
    { key: 'ready', title: '🟢 gotowy', blockers: [] },
    'Zielono.',
    '0123456789abcdef',
    'fedcba9876543210',
    'preset',
    [],
    true,
  );
  assert.equal(body.includes(MARKER), true);
  assert.match(body, /<sub>Kanarek · 2 pl\./);
  assert.equal(size(pr).key, 'tiny');
});
