import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BANK_KEY,
  loadBank,
  maintainBank,
  shouldUsePool,
  storeBank,
} from '../src/companion-bank.ts';
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
    blockerKinds(
      blocked,
      { behind: 0 },
      { failed: [], passed: [{}], pending: [], total: 1 },
      review,
      true,
    ),
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

  const firstBody = render(
    pr,
    { behind: 0 },
    firstCi,
    review,
    ['Feedseek'],
    firstStatus,
    'Still waiting for CI.',
    '0123456789abcdef',
    'fedcba9876543210',
    'preset',
    [],
    true,
  );
  const laterBody = render(
    pr,
    { behind: 0 },
    laterCi,
    review,
    ['Feedseek'],
    laterStatus,
    'Still waiting for CI.',
    '0123456789abcdef',
    'fedcba9876543210',
    'preset',
    [],
    true,
  );
  assert.equal(firstBody, laterBody);
  assert.match(firstBody, /CI 🟡/);
});

test('sanitizes contributor-controlled project area labels', () => {
  assert.deepEqual(areas(['@some-user/file.ts']), ['Some user']);
});

test('labels standalone split repositories from their root layout', () => {
  assert.deepEqual(
    areas(['app/src/main/MainActivity.kt', 'worker/src/index.ts'], 'twojstar/kanarek'),
    ['Kanarek Android', 'Kanarek Worker'],
  );
  assert.deepEqual(
    areas(['feed_generators/reuters.py', 'feeds.yaml'], 'trvny/feedseek'),
    ['Feedseek'],
  );
  assert.deepEqual(
    areas(['README.md', '.github/workflows/ci.yml'], 'trvny/feedseek'),
    ['Documentation', 'GitHub automation'],
  );
});

test('uses the bank outside the configured AI rollout', async () => {
  const quipKey = 'aaaaaaaaaaaaaaaa';
  const noAi = {} as CompanionEnv;
  assert.equal(await shouldUsePool(12, quipKey, 'ready', noAi), true);
  assert.equal(await shouldUsePool(12, quipKey, 'blocked', noAi), true);
  assert.equal(await shouldUsePool(12, quipKey, 'waiting', noAi), false);
  assert.equal(
    await shouldUsePool(12, quipKey, 'ready', {
      OPENAI_API_KEY: 'configured',
      KANAREK_AI_ENABLED: 'false',
    } as CompanionEnv),
    true,
  );
  assert.equal(
    await shouldUsePool(12, quipKey, 'ready', {
      OPENAI_API_KEY: 'configured',
      KANAREK_AI_PERCENT: '0',
    } as CompanionEnv),
    true,
  );
  assert.equal(
    await shouldUsePool(12, quipKey, 'ready', {
      OPENAI_API_KEY: 'configured',
      KANAREK_AI_PERCENT: '100',
    } as CompanionEnv),
    false,
  );
  const rolloutDecisions = await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      shouldUsePool(index + 1, quipKey, 'ready', {
        OPENAI_API_KEY: 'configured',
        KANAREK_AI_PERCENT: '25',
      } as CompanionEnv),
    ),
  );
  assert.equal(rolloutDecisions.includes(true), true);
  assert.equal(rolloutDecisions.includes(false), true);
});

test('keeps bank entries persistent, rotating, and bounded per quip key', async () => {
  const legacyQuip = 'Starszy poprawny tekst Kanarka z istniejącej bazy danych.';
  const firstParallel =
    'Pierwszy równoległy poprawny wpis Kanarka do trwałej bazy.';
  const secondParallel =
    'Drugi równoległy poprawny wpis Kanarka do trwałej bazy.';
  const rotatingQuip = (index: number) =>
    `Generated rotating Kanarek quip number ${index} for persistent bank testing.`;
  const boundedQuip = (index: number) =>
    `Persistent bounded Kanarek quip number ${index} for bank limit testing.`;
  const values = new Map<string, string>([
    [
      BANK_KEY,
      JSON.stringify([{ k: 'aaaaaaaaaaaaaaaa', q: legacyQuip }]),
    ],
  ]);
  const expirations = new Map<string, number>();
  const listed: Array<{ cursor?: string; limit?: number; prefix?: string }> = [];
  const ttlWrites: number[] = [];
  const kv = {
    async delete(key: string) {
      values.delete(key);
      expirations.delete(key);
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async list(options: { cursor?: string; limit?: number; prefix?: string }) {
      listed.push(options);
      const all = [...values.keys()]
        .filter((key) => key !== BANK_KEY && key.startsWith(options.prefix ?? ''))
        .sort();
      const offset = Number.parseInt(options.cursor ?? '0', 10) || 0;
      const limit = options.limit ?? 1_000;
      const names = all.slice(offset, offset + limit);
      const next = offset + names.length;
      return {
        keys: names.map((name) => ({ name, expiration: expirations.get(name) })),
        list_complete: next >= all.length,
        cursor: next < all.length ? String(next) : '',
      };
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      values.set(key, value);
      ttlWrites.push(options?.expirationTtl ?? 0);
      if (options?.expirationTtl) expirations.set(key, options.expirationTtl);
      else expirations.delete(key);
    },
  } as unknown as KVNamespace;
  const env = { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv;

  await Promise.all([
    storeBank(env, [{ k: 'bbbbbbbbbbbbbbbb', q: firstParallel }]),
    storeBank(env, [{ k: 'cccccccccccccccc', q: secondParallel }]),
  ]);

  assert.equal(
    [...values.keys()].filter((key) => key.startsWith(`${BANK_KEY}:entry:`)).length,
    2,
  );
  assert.deepEqual(ttlWrites, [0, 0]);

  const keys = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb', 'cccccccccccccccc'];
  const banks = await Promise.all(
    keys.map((key) => loadBank(env, key, '0000000000000000')),
  );
  for (const [index, bank] of banks.entries()) {
    assert.deepEqual(bank.map((entry) => entry.k), [keys[index]]);
  }

  const rotatingKey = 'dddddddddddddddd';
  for (let index = 0; index < 30; index += 1) {
    const name = `${BANK_KEY}:entry:${rotatingKey}:${index.toString(16).padStart(16, '0')}`;
    values.set(
      name,
      JSON.stringify([{ k: rotatingKey, q: rotatingQuip(index) }]),
    );
    expirations.set(name, 9_999_999_999 + index);
  }
  await maintainBank(env, true);
  assert.equal(
    [...expirations.keys()].filter((key) =>
      key.startsWith(`${BANK_KEY}:entry:${rotatingKey}:`),
    ).length,
    0,
  );

  const firstWindow = await loadBank(env, rotatingKey, '0000000000000000');
  const rotatedWindow = await loadBank(env, rotatingKey, '0000001800000000');
  assert.equal(firstWindow.length, 24);
  assert.equal(rotatedWindow.length, 24);
  assert.equal(firstWindow[0]?.q, rotatingQuip(0));
  assert.equal(rotatedWindow[0]?.q, rotatingQuip(24));

  const boundedKey = 'ffffffffffffffff';
  for (let index = 0; index < 270; index += 1) {
    await storeBank(env, [{ k: boundedKey, q: boundedQuip(index) }]);
  }
  assert.equal(
    [...values.keys()].filter((key) =>
      key.startsWith(`${BANK_KEY}:entry:${boundedKey}:`),
    ).length,
    256,
  );
  assert.equal(ttlWrites.every((ttl) => ttl === 0), true);
  assert.equal(
    listed.some(
      (entry) => entry.prefix === `${BANK_KEY}:entry:` && entry.limit === 1_000,
    ),
    true,
  );
});

test('removes unusable learned entries incrementally while reading a context', async () => {
  const quipKey = 'eeeeeeeeeeeeeeee';
  const prefix = `${BANK_KEY}:entry:${quipKey}:`;
  const wrongLanguageKey = `${prefix}0000000000000001`;
  const tooShortKey = `${prefix}0000000000000002`;
  const values = new Map<string, string>([
    [
      wrongLanguageKey,
      JSON.stringify([
        {
          k: quipKey,
          q: 'Everything works, green lights are calm and ready for takeoff.',
        },
      ]),
    ],
    [
      tooShortKey,
      JSON.stringify([{ k: quipKey, q: 'Za krótki stary wpis.' }]),
    ],
  ]);
  const deleted: string[] = [];
  const kv = {
    async delete(key: string) {
      deleted.push(key);
      values.delete(key);
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async list(options: { prefix?: string }) {
      const names = [...values.keys()].filter((key) =>
        key.startsWith(options.prefix ?? ''),
      );
      return { keys: names.map((name) => ({ name })), list_complete: true, cursor: '' };
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
  } as unknown as KVNamespace;
  const env = { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv;

  assert.deepEqual(
    await loadBank(env, quipKey, '0000000000000000', undefined, 'pl'),
    [],
  );
  assert.deepEqual(new Set(deleted), new Set([wrongLanguageKey, tooShortKey]));
  assert.equal(values.size, 0);
});

test('continues legacy TTL migration without waiting for the maintenance interval', async () => {
  const values = new Map<string, string>();
  const expirations = new Map<string, number>();
  const prefix = `${BANK_KEY}:entry:`;
  const quipKey = 'abababababababab';
  for (let index = 0; index < 230; index += 1) {
    const name = `${prefix}${quipKey}:${index.toString(16).padStart(16, '0')}`;
    values.set(
      name,
      JSON.stringify([
        {
          k: quipKey,
          q: `Legacy expiring Kanarek quip number ${index} kept for TTL migration testing.`,
        },
      ]),
    );
    expirations.set(name, 10_000_000_000 + index);
  }
  const kv = {
    async delete(key: string) {
      values.delete(key);
      expirations.delete(key);
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async list(options: { cursor?: string; limit?: number; prefix?: string }) {
      const all = [...values.keys()]
        .filter((key) => key.startsWith(options.prefix ?? ''))
        .sort();
      const offset = Number.parseInt(options.cursor ?? '0', 10) || 0;
      const limit = options.limit ?? 1_000;
      const names = all.slice(offset, offset + limit);
      const next = offset + names.length;
      return {
        keys: names.map((name) => ({ name, expiration: expirations.get(name) })),
        list_complete: next >= all.length,
        cursor: next < all.length ? String(next) : '',
      };
    },
    async put(key: string, value: string) {
      values.set(key, value);
      expirations.delete(key);
    },
  } as unknown as KVNamespace;
  const env = { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv;

  const first = await maintainBank(env, true);
  const second = await maintainBank(env);
  assert.equal(first.migrated, 200);
  assert.equal(second.skipped, false);
  assert.equal(second.migrated, 30);
  assert.equal(expirations.size, 0);
  assert.equal((await maintainBank(env)).skipped, true);
});

test('reconciles the whole learned bank incrementally to a finite global limit', async () => {
  const values = new Map<string, string>();
  const prefix = `${BANK_KEY}:entry:`;
  for (let index = 0; index < 4_150; index += 1) {
    const quipKey = Math.floor(index / 250).toString(16).padStart(16, '0');
    const identity = index.toString(16).padStart(16, '0');
    values.set(
      `${prefix}${quipKey}:${identity}`,
      JSON.stringify([
        {
          k: quipKey,
          q: `Global persistent Kanarek quip number ${index} for finite bank limit testing.`,
        },
      ]),
    );
  }
  const kv = {
    async delete(key: string) {
      values.delete(key);
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async list(options: { cursor?: string; limit?: number; prefix?: string }) {
      const all = [...values.keys()]
        .filter((key) => key.startsWith(options.prefix ?? ''))
        .sort();
      const offset = Number.parseInt(options.cursor ?? '0', 10) || 0;
      const limit = options.limit ?? 1_000;
      const names = all.slice(offset, offset + limit);
      const next = offset + names.length;
      return {
        keys: names.map((name) => ({ name })),
        list_complete: next >= all.length,
        cursor: next < all.length ? String(next) : '',
      };
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
  } as unknown as KVNamespace;
  const env = { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv;

  const first = await maintainBank(env, true);
  assert.equal(first.pruned, 24);
  assert.equal(
    [...values.keys()].filter((key) => key.startsWith(prefix)).length,
    4_126,
  );
  await maintainBank(env, true);
  await maintainBank(env, true);

  const entryKeys = [...values.keys()].filter((key) => key.startsWith(prefix));
  assert.equal(entryKeys.length, 4_096);
  const perKey = new Map<string, number>();
  for (const key of entryKeys) {
    const quipKey = key.slice(prefix.length, prefix.length + 16);
    perKey.set(quipKey, (perKey.get(quipKey) ?? 0) + 1);
  }
  assert.equal(Math.max(...perKey.values()) <= 256, true);
});
