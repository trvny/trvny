import assert from 'node:assert/strict';
import test from 'node:test';

import { BANK_KEY, loadBank } from '../src/companion-bank.ts';
import type { CompanionEnv } from '../src/companion-types.ts';

const quipKey = 'aaaaaaaaaaaaaaaa';
const validKey = `${BANK_KEY}:entry:${quipKey}:0000000000000001`;
const invalidKey = `${BANK_KEY}:entry:${quipKey}:0000000000000002`;
const validQuip = 'Kanarek pilnuje zielonych lampek i spokojnie zamyka skrzynke.';

test('keeps reusable entries when best-effort cleanup deletion fails', async () => {
  const values = new Map<string, string>([
    [validKey, JSON.stringify([{ k: quipKey, q: validQuip }])],
    [invalidKey, JSON.stringify([{ k: quipKey, q: 'Za krótko.' }])],
  ]);
  const kv = {
    async delete(key: string) {
      if (key === invalidKey) throw new Error('temporary KV delete failure');
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
  } as unknown as KVNamespace;
  const env = { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv;

  const bank = await loadBank(env, quipKey, '0000000000000000', undefined, 'pl');
  assert.deepEqual(bank, [{ k: quipKey, q: validQuip }]);
  assert.equal(values.has(invalidKey), true);
});
