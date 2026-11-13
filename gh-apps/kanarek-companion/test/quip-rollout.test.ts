import assert from 'node:assert/strict';
import test from 'node:test';

import { quipRolloutNumber, reuseQuipForHead } from '../src/companion/companion.ts';
import { render } from '../src/companion/companion-view.ts';
import { shouldAskAi } from '../src/companion/quip.ts';

test('reuses a quip for repeated webhooks on the same PR head only', () => {
  const key = 'a'.repeat(16);
  const head = 'b'.repeat(40);
  assert.equal(reuseQuipForHead(key, key, head, head, 'A valid existing quip.'), true);
  assert.equal(reuseQuipForHead(key, key, head, 'c'.repeat(40), 'A valid existing quip.'), false);
  assert.equal(reuseQuipForHead(key, key, undefined, head, 'A valid existing quip.'), true);
  assert.equal(reuseQuipForHead('c'.repeat(16), key, head, head, 'A valid existing quip.'), false);
});

test('renders the actual PR head independently of semantic state hash', () => {
  const head = 'b'.repeat(40);
  const body = render(
    {
      additions: 1,
      deletions: 1,
      changed_files: 1,
      auto_merge: null,
      base: { ref: 'main', sha: 'a'.repeat(40) },
      draft: false,
      head: { sha: head },
      labels: [],
      mergeable: true,
      mergeable_state: 'clean',
      merged: false,
      number: 13,
      state: 'open',
    },
    { behind: 0 },
    { failed: [], passed: [{}], pending: [], total: 1 },
    { approvals: 0, changes: 0 },
    ['App'],
    { key: 'ready', title: 'Ready', blockers: [] },
    'A quip fitting the PR state without leaking changed code.',
    'c'.repeat(16),
    'd'.repeat(16),
    'preset',
    [],
  );
  assert.ok(body.includes(`kanarek-quip-head:${head}`));
});

test('rollout stays stable per revision, but new revisions can receive AI', async () => {
  const head = 'a'.repeat(40);
  assert.equal(await quipRolloutNumber(13, head), await quipRolloutNumber(13, head));
  assert.notEqual(await quipRolloutNumber(13, head), await quipRolloutNumber(13, 'b'.repeat(40)));
  const env = { OPENAI_API_KEY: 'configured', KANAREK_AI_PERCENT: '25' };
  const key = 'd'.repeat(16);
  const eligible = await Promise.all(
    Array.from({ length: 48 }, async (_, i) => {
      const roll = await quipRolloutNumber(13, i.toString(16).padStart(40, '0'));
      return shouldAskAi(roll, key, 'ready', env);
    }),
  );
  assert.equal(eligible.some(Boolean), true);
  assert.equal(eligible.some((value) => !value), true);
});

test('bounds billable quip attempts per PR across fresh heads', async () => {
  const values = new Map<string, string>();
  const writes: Array<{ key: string; ttl: number | undefined }> = [];
  const kv = {
    async get(key: string) { return values.get(key) ?? null; },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      values.set(key, value);
      writes.push({ key, ttl: options?.expirationTtl });
    },
  } as unknown as KVNamespace;
  const { claimAiWindow } = await import('../src/companion/companion-bank.ts');
  const env = { KANAREK_QUIP_KV: kv };
  assert.equal(await claimAiWindow(env as never, 'trvny/trvny', 13), true);
  assert.equal(await claimAiWindow(env as never, 'trvny/trvny', 13), false);
  assert.equal(await claimAiWindow(env as never, 'trvny/trvny', 14), true);
  assert.equal(writes.length, 2);
  assert.equal(writes[0]?.ttl, 3600);
});
