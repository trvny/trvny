import assert from 'node:assert/strict';
import test from 'node:test';

import { aiQuip } from '../src/quip.ts';

test('does not copy provider error bodies into logs', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message?: unknown) => warnings.push(String(message));
  try {
    const fetcher = (async () =>
      new Response('SECRET_PROMPT_FRAGMENT should never reach logs', {
        status: 429,
      })) as typeof fetch;

    assert.equal(
      await aiQuip(
        '{}',
        {
          OPENAI_API_KEY: 'test',
          KANAREK_OPENAI_MODEL: 'gpt-5.6-luna',
          KANAREK_OPENAI_FALLBACK_MODEL: 'gpt-5.6-luna',
        },
        fetcher,
      ),
      null,
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /returned 429/);
    assert.equal(warnings[0].includes('SECRET_PROMPT_FRAGMENT'), false);
  } finally {
    console.warn = originalWarn;
  }
});
