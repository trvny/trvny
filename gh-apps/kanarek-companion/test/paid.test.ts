import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deletePaidState,
  loadPaidState,
  storePaidState,
} from '../src/companion-paid.ts';
import type { CompanionEnv } from '../src/companion-types.ts';

const repository = 'trvny/trvny';
const pullRequestNumber = 199;
const stateHash = '0123456789abcdef';
const quipKey = 'fedcba9876543210';
const quip = 'Kanarek pilnuje zielonych lampek i spokojnie zamyka skrzynke.';

function memoryEnv() {
  const values = new Map<string, string>();
  const ttls = new Map<string, number>();
  const deleted: string[] = [];
  const kv = {
    async delete(key: string) {
      deleted.push(key);
      values.delete(key);
      ttls.delete(key);
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      values.set(key, value);
      if (options?.expirationTtl) ttls.set(key, options.expirationTtl);
    },
  } as unknown as KVNamespace;
  return {
    deleted,
    env: { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv,
    ttls,
    values,
  };
}

test('reuses a valid paid quip for the exact PR state without another AI call', async () => {
  const memory = memoryEnv();
  assert.equal(
    await storePaidState(
      memory.env,
      repository,
      pullRequestNumber,
      stateHash,
      quipKey,
      quip,
      'pl',
    ),
    true,
  );
  assert.equal(
    await loadPaidState(
      memory.env,
      repository,
      pullRequestNumber,
      stateHash,
      quipKey,
      'pl',
    ),
    quip,
  );
  assert.equal(memory.values.size, 1);
  assert.equal([...memory.ttls.values()][0], 7 * 24 * 60 * 60);
});

test('retires a paid receipt once durable bank storage succeeds', async () => {
  const memory = memoryEnv();
  await storePaidState(
    memory.env,
    repository,
    pullRequestNumber,
    stateHash,
    quipKey,
    quip,
    'pl',
  );

  assert.equal(
    await deletePaidState(
      memory.env,
      repository,
      pullRequestNumber,
      stateHash,
    ),
    true,
  );
  assert.equal(memory.values.size, 0);
  assert.equal(memory.ttls.size, 0);
});

test('does not share a receipt between PRs with the same state hash', async () => {
  const memory = memoryEnv();
  await storePaidState(
    memory.env,
    repository,
    pullRequestNumber,
    stateHash,
    quipKey,
    quip,
    'pl',
  );

  assert.equal(
    await loadPaidState(
      memory.env,
      repository,
      pullRequestNumber + 1,
      stateHash,
      quipKey,
      'pl',
    ),
    null,
  );
  assert.equal(memory.values.size, 1);
});

test('does not reuse a receipt for another quip context', async () => {
  const memory = memoryEnv();
  await storePaidState(
    memory.env,
    repository,
    pullRequestNumber,
    stateHash,
    quipKey,
    quip,
    'pl',
  );

  assert.equal(
    await loadPaidState(
      memory.env,
      repository,
      pullRequestNumber,
      stateHash,
      'aaaaaaaaaaaaaaaa',
      'pl',
    ),
    null,
  );
  assert.equal(memory.values.size, 0);
  assert.equal(memory.deleted.length, 1);
});

test('rejects invalid or wrong-language paid receipts', async () => {
  const memory = memoryEnv();
  assert.equal(
    await storePaidState(
      memory.env,
      repository,
      pullRequestNumber,
      stateHash,
      quipKey,
      'Za krótko.',
      'pl',
    ),
    false,
  );
  assert.equal(
    await storePaidState(
      memory.env,
      repository,
      pullRequestNumber,
      stateHash,
      quipKey,
      'Everything works, green lights ready for takeoff.',
      'pl',
    ),
    false,
  );
  assert.equal(memory.values.size, 0);
});

test('fails closed when the paid-state KV write fails', async () => {
  const env = {
    KANAREK_QUIP_KV: {
      async put() {
        throw new Error('kv unavailable');
      },
    } as unknown as KVNamespace,
  } as unknown as CompanionEnv;

  assert.equal(
    await storePaidState(
      env,
      repository,
      pullRequestNumber,
      stateHash,
      quipKey,
      quip,
      'pl',
    ),
    false,
  );
});
