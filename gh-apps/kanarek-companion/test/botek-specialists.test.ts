import assert from 'node:assert/strict';
import test from 'node:test';

import {
  botekEngramSearch,
  botekEngramStatus,
  botekEngramStore,
} from '../src/botek-specialists.ts';

test('Botek Engram status reuses the canonical specialist backend', async () => {
  const calls: string[] = [];
  const result = await botekEngramStatus(
    { ENGRAM_API_KEY: 'eng_test' },
    (input) => {
      calls.push(String(input));
      return Promise.resolve(Response.json({ status: 'ok' }));
    },
  );

  assert.deepEqual(calls, ['https://api.engrammemory.ai/v1/health']);
  assert.deepEqual(result, { ok: true, configured: true, reachable: true });
});

test('Botek Engram search stays personal and bounded by the shared adapter', async () => {
  const fetcher: typeof fetch = (input, init) => {
    assert.equal(String(input), 'https://api.engrammemory.ai/v1/search');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      query: 'what did we decide?',
      top_k: 4,
      scope: 'personal',
    });
    return Promise.resolve(Response.json({
      results: [{ id: 'm1', content: 'Use one source of truth.', score: 0.9 }],
      query_tokens: 6,
    }));
  };

  const result = await botekEngramSearch(
    { ENGRAM_API_KEY: 'eng_test' },
    'what did we decide?',
    4,
    fetcher,
  );

  assert.equal(result.ok, true);
  assert.deepEqual(
    (result.results as Array<Record<string, unknown>>)[0]?.content,
    'Use one source of truth.',
  );
});

test('Botek Engram store stamps client metadata without owning the credential', async () => {
  const fetcher: typeof fetch = (input, init) => {
    assert.equal(String(input), 'https://api.engrammemory.ai/v1/store');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      text: 'Prefer squash merges.',
      category: 'preference',
      importance: 0.8,
      metadata: {
        project: 'trvny/trvny',
        client: 'botek',
        source: 'mechagremlin',
      },
      collection: 'agent-memory',
    });
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer eng_test');
    return Promise.resolve(Response.json({
      id: 'm2',
      status: 'stored',
      category: 'preference',
      duplicate: false,
    }));
  };

  const result = await botekEngramStore(
    { ENGRAM_API_KEY: 'eng_test' },
    {
      text: 'Prefer squash merges.',
      category: 'preference',
      importance: 0.8,
      metadata: { project: 'trvny/trvny' },
    },
    fetcher,
  );

  assert.equal(result.ok, true);
  assert.equal(result.id, 'm2');
});
