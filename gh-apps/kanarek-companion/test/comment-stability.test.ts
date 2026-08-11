import assert from 'node:assert/strict';
import test from 'node:test';

import { commentStateHash, render } from '../src/companion.ts';
import type { PullRequest } from '../src/companion-types.ts';

const basePr: PullRequest = {
  additions: 2,
  auto_merge: null,
  base: { ref: 'main', sha: 'a'.repeat(40) },
  changed_files: 2,
  deletions: 1,
  draft: false,
  head: { sha: 'b'.repeat(40) },
  mergeable: true,
  mergeable_state: 'clean',
  merged: false,
  number: 200,
  state: 'open',
};

const stateAndBody = async (head: string) => {
  const review = { approvals: 0, changes: 0 };
  const stateHash = await commentStateHash(
    {
      status: 'ready',
      blockers: [],
      area: 'Gh apps',
      size: 'tiny',
      language: 'en',
    },
    {
      head,
      behind: 0,
      reviews: review,
      autoMerge: null,
      files: 2,
    },
  );
  const body = render(
    { ...basePr, head: { sha: head } },
    { behind: 0 },
    { failed: [], passed: [{}], pending: [], total: 1 },
    review,
    ['Gh apps'],
    { key: 'ready', title: '🟢 ready', blockers: [] },
    'Ready.',
    stateHash,
    'fedcba9876543210',
    'preset',
    [],
    true,
  );
  return { stateHash, body };
};

test('keeps comment state and rendering stable across head-only changes', async () => {
  const first = await stateAndBody('1'.repeat(40));
  const second = await stateAndBody('2'.repeat(40));
  assert.equal(first.stateHash, second.stateHash);
  assert.equal(first.body, second.body);
});
