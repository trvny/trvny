import assert from 'node:assert/strict';
import test from 'node:test';

import { behindState, blockerKinds, commentStateHash, render } from '../src/companion.ts';
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

test('keeps CI startup stable from missing results into pending checks', async () => {
  const review = { approvals: 0, changes: 0 };
  const facts = {
    status: 'waiting',
    blockers: ['ci-missing'],
    area: 'Gh apps',
    size: 'tiny',
    language: 'en',
  };
  const stateHash = await commentStateHash(facts, {
    head: '1'.repeat(40),
    behind: 0,
    reviews: review,
    autoMerge: null,
    files: 2,
  });
  const current = {
    key: 'waiting',
    title: '🟡 waiting',
    blockers: ['no CI results'],
  };
  const missingBody = render(
    basePr,
    { behind: 0 },
    { failed: [], passed: [], pending: [], total: 0 },
    review,
    ['Gh apps'],
    current,
    'Waiting for CI.',
    stateHash,
    'fedcba9876543210',
    'preset',
    [],
    true,
  );
  const pendingBody = render(
    basePr,
    { behind: 0 },
    { failed: [], passed: [], pending: [{}, {}], total: 2 },
    review,
    ['Gh apps'],
    { ...current, blockers: ['2 checks pending'] },
    'Waiting for CI.',
    stateHash,
    'fedcba9876543210',
    'preset',
    [],
    true,
  );
  assert.equal(missingBody, pendingBody);
  assert.match(missingBody, /CI 🟡/);
});

test('keeps optional pending CI represented in quip facts', () => {
  assert.deepEqual(
    blockerKinds(
      basePr,
      { behind: 0 },
      { failed: [], passed: [], pending: [{}], total: 1 },
      { approvals: 0, changes: 0 },
      false,
    ),
    ['ci-pending'],
  );
});

test('freezes merged comments against late CI, review, and branch churn', async () => {
  const facts = {
    status: 'merged',
    blockers: [] as string[],
    area: 'Gh apps',
    size: 'tiny',
    language: 'en',
  };
  const firstHash = await commentStateHash(facts, {
    head: '1'.repeat(40),
    behind: 0,
    reviews: { approvals: 2, changes: 0 },
    autoMerge: 'squash',
    files: 2,
  });
  const laterHash = await commentStateHash(facts, {
    head: '2'.repeat(40),
    behind: 9,
    reviews: { approvals: 0, changes: 3 },
    autoMerge: null,
    files: 2,
  });
  assert.equal(firstHash, laterHash);

  const mergedPr = { ...basePr, merged: true, state: 'closed' } as PullRequest;
  const firstBody = render(
    mergedPr,
    { behind: 0 },
    { failed: [], passed: [{}], pending: [], total: 1 },
    { approvals: 2, changes: 0 },
    ['Gh apps'],
    { key: 'merged', title: '🟣 merged', blockers: [] },
    'Merged.',
    firstHash,
    'fedcba9876543210',
    'preset',
    [],
    true,
  );
  const laterBody = render(
    mergedPr,
    { behind: 9 },
    { failed: [{}], passed: [], pending: [{}, {}], total: 3 },
    { approvals: 0, changes: 3 },
    ['Gh apps'],
    { key: 'merged', title: '🟣 merged', blockers: [] },
    'Merged.',
    laterHash,
    'fedcba9876543210',
    'preset',
    [],
    true,
  );
  assert.equal(firstBody, laterBody);
  assert.doesNotMatch(firstBody, /CI |review /);
});

// A merge to the base branch changes `behind` for every open pull request at
// once. When that count reached the state hash verbatim, one merge rewrote every
// companion comment, saying nothing new about any of them. The hash now stores
// whether we are behind, so a pull request falls behind once and stays put.
const behindHash = (behind: number) =>
  commentStateHash(
    {
      status: 'ready',
      blockers: behind > 0 ? ['behind'] : [],
      area: 'Gh apps',
      size: 'tiny',
      language: 'en',
    },
    {
      head: 'b'.repeat(40),
      behind,
      reviews: { approvals: 0, changes: 0 },
      autoMerge: null,
      files: 2,
    },
  );

test('behindState reduces the distance to whether we are behind', () => {
  assert.equal(behindState(null), 'unknown');
  assert.equal(behindState(0), 'current');
  assert.equal(behindState(1), 'behind');
  assert.equal(behindState(97), 'behind');
});

test('drifting further behind leaves the state hash alone', async () => {
  assert.equal(await behindHash(1), await behindHash(4));
  assert.equal(await behindHash(4), await behindHash(97));
});

test('falling behind at all still changes the state hash', async () => {
  assert.notEqual(await behindHash(0), await behindHash(1));
});

test('the branch badge reports the state, not the count', () => {
  const body = (behind: number) =>
    render(
      basePr,
      { behind },
      { failed: [], passed: [{}], pending: [], total: 1 },
      { approvals: 0, changes: 0 },
      ['Gh apps'],
      { key: 'ready', title: '\u{1F7E2} ready', blockers: [] },
      'Ready.',
      '0'.repeat(16),
      'fedcba9876543210',
      'preset',
      [],
      true,
    );

  assert.ok(body(3).includes('\u2193'));
  assert.equal(body(1), body(97));
  assert.notEqual(body(0), body(1));
});
