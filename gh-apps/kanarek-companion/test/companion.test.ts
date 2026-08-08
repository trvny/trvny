import assert from 'node:assert/strict';
import test from 'node:test';

import { BANK_KEY, loadBank, storeBank } from '../src/companion-bank.ts';
import {
  areas,
  blockerKinds,
  isCompanionDisabled,
  MARKER,
  render,
  size,
  status,
} from '../src/companion.ts';
import type { CompanionEnv } from '../src/companion.ts';

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

test('disables the companion only for the no-goblin label', () => {
  assert.equal(isCompanionDisabled({ labels: [{ name: 'no-goblin' }] }), true);
  assert.equal(isCompanionDisabled({ labels: [{ name: 'NO-GOBLIN' }] }), true);
  assert.equal(isCompanionDisabled({ labels: [{ name: 'bug' }] }), false);
  assert.equal(isCompanionDisabled({}), false);
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
    { key: 'ready', title: '🟢 ready', blockers: [] },
    'Green across the board.',
    '0123456789abcdef',
    'fedcba9876543210',
    'preset',
    [],
    true,
  );
  assert.equal(body.includes(MARKER), true);
  assert.match(body, /<sub>Kanarek · 2 files/);
  assert.equal(size(pr).key, 'tiny');
});

test('keeps the rendered comment stable while pending checks finish', () => {
  const firstCi = { failed: [], passed: [{}], pending: [{}, {}], total: 3 };
  const laterCi = { failed: [], passed: [{}, {}], pending: [{}], total: 3 };
  const firstStatus = status(pr, { behind: 0 }, firstCi, review, true);
  const laterStatus = status(pr, { behind: 0 }, laterCi, review, true);
  assert.equal(firstStatus.key, laterStatus.key);

  const args = [
    review,
    ['Feedseek'],
    'Still waiting for CI.',
    '0123456789abcdef',
    'fedcba9876543210',
    'preset' as const,
    [],
    true,
  ] as const;
  const firstBody = render(pr, { behind: 0 }, firstCi, firstStatus, ...args);
  const laterBody = render(pr, { behind: 0 }, laterCi, laterStatus, ...args);
  assert.equal(firstBody, laterBody);
  assert.match(firstBody, /CI 🟡/);
});

test('sanitizes contributor-controlled project area labels', () => {
  assert.deepEqual(areas(['@some-user/file.ts']), ['Some user']);
});

test('stores concurrent quips under independent KV keys', async () => {
  const values = new Map<string, string>([
    [
      BANK_KEY,
      JSON.stringify([
        { k: 'aaaaaaaaaaaaaaaa', q: 'Starszy tekst z istniejącej bazy.' },
      ]),
    ],
  ]);
  const kv = {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async list(options: { prefix?: string }) {
      return {
        keys: [...values.keys()]
          .filter((key) => key !== BANK_KEY && key.startsWith(options.prefix ?? ''))
          .map((name) => ({ name })),
        list_complete: true,
      };
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
  } as unknown as KVNamespace;
  const env = { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv;

  await Promise.all([
    storeBank(env, [
      { k: 'bbbbbbbbbbbbbbbb', q: 'Pierwszy równoległy wpis Kanarka.' },
    ]),
    storeBank(env, [
      { k: 'cccccccccccccccc', q: 'Drugi równoległy wpis Kanarka.' },
    ]),
  ]);

  assert.equal(
    [...values.keys()].filter((key) => key !== BANK_KEY).length,
    2,
  );
  const bank = await loadBank(env);
  assert.deepEqual(
    new Set(bank.map((entry) => entry.k)),
    new Set(['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc']),
  );
});
