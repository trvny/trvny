import assert from 'node:assert/strict';
import test from 'node:test';

import { BANK_KEY, loadBank } from '../src/companion/companion-bank.ts';
import type { CompanionEnv } from '../src/companion/companion-types.ts';

function bankKey(quipKey: string, identity: string): string {
  return `${BANK_KEY}:entry:${quipKey}:${identity}`;
}

test('removes an entry whose payload context disagrees with its key', async () => {
  const quipKey = 'aaaaaaaaaaaaaaaa';
  const key = bankKey(quipKey, '0000000000000001');
  const values = new Map([
    [
      key,
      JSON.stringify([
        {
          k: 'bbbbbbbbbbbbbbbb',
          q: 'Kanarek pilnuje zielonych lampek i spokojnie zamyka skrzynke.',
        },
      ]),
    ],
  ]);
  const deleted: string[] = [];
  const kv = {
    async delete(name: string) {
      deleted.push(name);
      values.delete(name);
    },
    async get(name: string) {
      return values.get(name) ?? null;
    },
    async list(options: { prefix?: string }) {
      const names = [...values.keys()].filter((name) =>
        name.startsWith(options.prefix ?? ''),
      );
      return { keys: names.map((name) => ({ name })), list_complete: true, cursor: '' };
    },
  } as unknown as KVNamespace;
  const env = { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv;

  assert.deepEqual(
    await loadBank(env, quipKey, '0000000000000000', undefined, 'pl'),
    [],
  );
  assert.deepEqual(deleted, [key]);
});

test('samples past change-specific entries without deleting them', async () => {
  const quipKey = 'cccccccccccccccc';
  const values = new Map<string, string>();
  for (let index = 0; index < 24; index += 1) {
    values.set(
      bankKey(quipKey, index.toString(16).padStart(16, '0')),
      JSON.stringify([
        { k: quipKey, l: 'en', q: `Ready: tiny wrangler bump to version ${index}, zero blockers in sight.` },
      ]),
    );
  }
  const generic = 'Green across the board, and Kanarek has nothing left to complain about.';
  values.set(
    bankKey(quipKey, 'ffffffffffffffff'),
    JSON.stringify([{ k: quipKey, l: 'en', q: generic }]),
  );
  const deleted: string[] = [];
  const kv = {
    async delete(name: string) {
      deleted.push(name);
    },
    async get(name: string) {
      return values.get(name) ?? null;
    },
    async list() {
      return { keys: [...values.keys()].map((name) => ({ name })), list_complete: true, cursor: '' };
    },
  } as unknown as KVNamespace;
  const env = { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv;

  const bank = await loadBank(env, quipKey, '0000000000000000', undefined, 'en', 'Other');
  assert.deepEqual(bank.map((entry) => entry.q), [generic]);
  assert.deepEqual(deleted, []);
});
