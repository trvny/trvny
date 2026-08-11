import assert from 'node:assert/strict';
import test from 'node:test';

import { storeBank } from '../src/companion-bank.ts';
import type { CompanionEnv } from '../src/companion-types.ts';

test('returns false when every offered bank entry is rejected by validation', async () => {
  let listCalls = 0;
  let writes = 0;
  const kv = {
    async delete() {},
    async list() {
      listCalls += 1;
      return { keys: [], list_complete: true, cursor: '' };
    },
    async put() {
      writes += 1;
    },
  } as unknown as KVNamespace;
  const env = { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv;

  assert.equal(
    await storeBank(env, [
      { k: 'aaaaaaaaaaaaaaaa', q: 'Za krótko.' },
      {
        k: 'bad-key',
        q: 'Kanarek pilnuje zielonych lampek i spokojnie zamyka skrzynke.',
      },
    ]),
    false,
  );
  assert.equal(listCalls, 0);
  assert.equal(writes, 0);
});
