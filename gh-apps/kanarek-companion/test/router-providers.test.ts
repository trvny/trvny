import assert from 'node:assert/strict';
import test from 'node:test';

import { aiQuip, hasAiProvider, type QuipEnv } from '../src/quip.ts';

const VALID_QUIP = 'Kanarek checks the paid provider panel and finds every dial behaving.';

function legacyFreeEnv(): QuipEnv {
  return {
    OPENROUTER_API_KEY: 'router',
    ORCAROUTER_API_KEY: 'orca',
  } as unknown as QuipEnv;
}

test('free router credentials do not enable quip AI', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return new Response();
  }) as typeof fetch;

  assert.equal(hasAiProvider(legacyFreeEnv()), false);
  assert.equal(await aiQuip('{}', legacyFreeEnv(), fetcher), null);
  assert.equal(calls, 0);
});
test('paid direct providers still generate quips with legacy free secrets present', async () => {
  let url = '';
  const fetcher = (async (input: RequestInfo | URL) => {
    url = String(input);
    return Response.json({ status: 'completed', output_text: VALID_QUIP });
  }) as typeof fetch;
  const env = {
    ...legacyFreeEnv(),
    OPENAI_API_KEY: 'openai',
    KANAREK_OPENAI_FALLBACK_MODEL: 'gpt-5.6-luna',
  };

  assert.equal(await aiQuip('{}', env, fetcher), VALID_QUIP);
  assert.equal(url, 'https://api.openai.com/v1/responses');
});
