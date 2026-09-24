import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARCHIVE_PREFIX,
  BANK_KEY,
  RECOVERED_BANK_PREFIX,
  BANK_LIMIT,
  archiveQuip,
  bankCapacity,
  bankContext,
  effectiveAiPercent,
  loadBank,
  shouldAskAiForBank,
  shouldUsePool,
} from '../src/companion-bank.ts';
import type { CompanionEnv } from '../src/companion-types.ts';
import { hash } from '../src/quip.ts';

const quipKey = 'aaaaaaaaaaaaaaaa';
const aiEnv = {
  OPENAI_API_KEY: 'configured',
  KANAREK_AI_PERCENT: '25',
} as CompanionEnv;

function capacity(size: number, limit = BANK_LIMIT) {
  return { available: true, limit, size };
}

test('shrinks the configured AI ceiling as the current bank context fills', () => {
  assert.equal(effectiveAiPercent(aiEnv, capacity(0)), 25);
  assert.equal(effectiveAiPercent(aiEnv, capacity(128)), 13);
  assert.equal(effectiveAiPercent(aiEnv, capacity(253)), 1);
  assert.equal(effectiveAiPercent(aiEnv, capacity(255)), 1);
  assert.equal(effectiveAiPercent(aiEnv, capacity(BANK_LIMIT)), 0);
});

test('uses the actual retainable context quota as the denominator', () => {
  assert.equal(effectiveAiPercent(aiEnv, capacity(20, 41)), 13);
  assert.equal(effectiveAiPercent(aiEnv, capacity(40, 41)), 1);
  assert.equal(effectiveAiPercent(aiEnv, capacity(41, 41)), 0);
});

test('does not spend AI credits when the persistent bank is unavailable', () => {
  assert.equal(
    effectiveAiPercent(aiEnv, {
      available: false,
      limit: BANK_LIMIT,
      size: 0,
    }),
    0,
  );
});

test('a full context always falls back to the pool even with a 100 percent ceiling', async () => {
  const env = {
    OPENAI_API_KEY: 'configured',
    KANAREK_AI_PERCENT: '100',
  } as CompanionEnv;
  const full = capacity(BANK_LIMIT);

  assert.equal(await shouldAskAiForBank(12, quipKey, 'ready', env, full), false);
  assert.equal(await shouldUsePool(12, quipKey, 'ready', env, full), true);
});

test('keeps the archive outside active-bank fullness and AI scaling', async () => {
  const values = new Map<string, string>();
  const kv = {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
    async list(options: { prefix?: string }) {
      const keys = [...values.keys()]
        .filter((name) => !options.prefix || name.startsWith(options.prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    },
  } as unknown as KVNamespace;
  const env = {
    ...aiEnv,
    KANAREK_QUIP_KV: kv,
  } as unknown as CompanionEnv;

  assert.equal(
    await archiveQuip(
      env,
      'travnie/aistee',
      quipKey,
      'Archived Kanarek prose stays durable without changing active bank fullness or AI rollout.',
      'en',
    ),
    true,
  );
  assert.equal(
    [...values.keys()].some((key) => key.startsWith(ARCHIVE_PREFIX)),
    true,
  );

  const result = await bankCapacity(env, quipKey);
  assert.deepEqual(result, { available: true, limit: BANK_LIMIT, size: 0 });
  assert.equal(effectiveAiPercent(env, result), 25);
});

test('reuses repo-scoped recovered v1 quips for bank fullness and selection', async () => {
  const repository = 'travnie/aistee';
  const recoveredQuipKey = 'bbbbbbbbbbbbbbbb';
  const repositoryHash = await hash(repository);
  const values = new Map<string, string>();
  for (let index = 0; index < 128; index += 1) {
    const identity = index.toString(16).padStart(16, '0');
    values.set(
      `${RECOVERED_BANK_PREFIX}${repositoryHash}:${recoveredQuipKey}:${identity}`,
      JSON.stringify([
        {
          k: recoveredQuipKey,
          l: 'en',
          q: `Recovered Aistee bank quip number ${index} remains safely scoped to its original repository.`,
        },
      ]),
    );
  }
  const kv = {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async list(options: { prefix?: string }) {
      const keys = [...values.keys()]
        .filter((name) => !options.prefix || name.startsWith(options.prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: '' };
    },
  } as unknown as KVNamespace;
  const env = {
    ...aiEnv,
    KANAREK_QUIP_KV: kv,
  } as unknown as CompanionEnv;
  const recoveredScope = { repository, quipKey: recoveredQuipKey };

  const context = await bankContext(env, quipKey, 'en', recoveredScope);
  const bank = await loadBank(
    env,
    quipKey,
    '0000000000000000',
    context,
    'en',
    recoveredScope,
  );

  assert.equal(context.size, 128);
  assert.equal(effectiveAiPercent(aiEnv, context), 13);
  assert.equal(bank.length, 24);
  assert.equal(bank.every((entry) => entry.k === quipKey), true);

  const otherRepo = await bankContext(env, quipKey, 'en', {
    repository: 'travnie/twojstar',
    quipKey: recoveredQuipKey,
  });
  assert.equal(otherRepo.size, 0);
});

test('counts legacy quips in the current context fullness', async () => {
  const legacy = Array.from({ length: 64 }, (_, index) => ({
    k: quipKey,
    q: `Legacy reusable Kanarek bank quip number ${index} remains valid for capacity testing.`,
  }));
  const kv = {
    async get(key: string) {
      return key === BANK_KEY ? JSON.stringify(legacy) : null;
    },
    async list() {
      return { keys: [], list_complete: true, cursor: '' };
    },
  } as unknown as KVNamespace;

  const result = await bankCapacity(
    { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv,
    quipKey,
  );

  assert.deepEqual(result, { available: true, limit: BANK_LIMIT, size: 64 });
});

test('reduces the context quota when the global retention cap is binding', async () => {
  const contexts = 100;
  const keys = Array.from({ length: contexts * 50 }, (_, index) => {
    const context = (index % contexts).toString(16).padStart(16, '0');
    const identity = Math.floor(index / contexts).toString(16).padStart(16, '0');
    return { name: `${BANK_KEY}:entry:${context}:${identity}` };
  });
  const kv = {
    async get() {
      return null;
    },
    async list(options: { cursor?: string }) {
      const offset = options.cursor ? Number.parseInt(options.cursor, 10) : 0;
      const page = keys.slice(offset, offset + 1_000);
      const next = offset + page.length;
      return {
        keys: page,
        list_complete: next >= keys.length,
        cursor: next >= keys.length ? '' : String(next),
      };
    },
  } as unknown as KVNamespace;

  const result = await bankCapacity(
    { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv,
    '0000000000000000',
  );

  assert.equal(result.limit, 41);
  assert.equal(result.size, 41);
  assert.equal(effectiveAiPercent(aiEnv, result), 0);
});

test('reuses measured keys and legacy data when falling back to the bank', async () => {
  const names = Array.from({ length: 37 }, (_, index) =>
    `${BANK_KEY}:entry:${quipKey}:${index.toString(16).padStart(16, '0')}`,
  );
  const values = new Map(
    names.map((name, index) => [
      name,
      JSON.stringify([
        {
          k: quipKey,
          q: `Reusable Kanarek bank quip number ${index} remains valid for measured fallback testing.`,
        },
      ]),
    ]),
  );
  let listCalls = 0;
  let legacyReads = 0;
  const kv = {
    async get(key: string) {
      if (key === BANK_KEY) {
        legacyReads += 1;
        return null;
      }
      return values.get(key) ?? null;
    },
    async list() {
      listCalls += 1;
      return {
        keys: names.map((name) => ({ name })),
        list_complete: true,
        cursor: '',
      };
    },
  } as unknown as KVNamespace;
  const env = { KANAREK_QUIP_KV: kv } as unknown as CompanionEnv;

  const context = await bankContext(env, quipKey);
  const bank = await loadBank(env, quipKey, '0000000000000000', context);

  assert.equal(context.size, 37);
  assert.equal(bank.length, 24);
  assert.equal(listCalls, 1);
  assert.equal(legacyReads, 1);
});
