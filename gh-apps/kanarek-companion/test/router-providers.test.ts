import assert from 'node:assert/strict';
import test from 'node:test';

import { aiQuip, hasAiProvider } from '../src/quip.ts';

const VALID_QUIP = 'Kanarek checks the free router and finds every cable behaving nicely.';

function chatResponse(text = VALID_QUIP): Response {
  return Response.json({
    choices: [{ finish_reason: 'stop', message: { content: text } }],
    usage: {
      completion_tokens: 19,
      completion_tokens_details: { reasoning_tokens: 3 },
    },
  });
}

test('uses the OpenRouter free model fallback chain', async () => {
  let url = '';
  let headers = new Headers();
  let body: Record<string, unknown> = {};
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input);
    headers = new Headers(init?.headers);
    body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return chatResponse();
  }) as typeof fetch;

  assert.equal(await aiQuip('{}', { OPENROUTER_API_KEY: 'router' }, fetcher), VALID_QUIP);
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(headers.get('authorization'), 'Bearer router');
  assert.equal(body.model, 'minimax/minimax-m3:free');
  assert.deepEqual(body.models, [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'poolside/laguna-s-2.1:free',
    'cohere/north-mini-code:free',
    'poolside/laguna-m.1:free',
    'nvidia/nemotron-3-super-120b-a12b:free',
    'openrouter/free',
  ]);
  assert.equal(body.max_tokens, 1_024);
});

test('honors a configured OpenRouter model chain', async () => {
  let body: Record<string, unknown> = {};
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return chatResponse();
  }) as typeof fetch;

  await aiQuip(
    '{}',
    {
      OPENROUTER_API_KEY: 'router',
      KANAREK_OPENROUTER_MODELS: 'one/free, two/free,one/free',
      KANAREK_OPENROUTER_MAX_TOKENS: '700',
    },
    fetcher,
  );

  assert.equal(body.model, 'one/free');
  assert.deepEqual(body.models, ['two/free']);
  assert.equal(body.max_tokens, 700);
});

test('delegates OrcaRouter selection to orcarouter/auto', async () => {
  let url = '';
  let body: Record<string, unknown> = {};
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input);
    body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return chatResponse();
  }) as typeof fetch;

  assert.equal(await aiQuip('{}', { ORCAROUTER_API_KEY: 'orca' }, fetcher), VALID_QUIP);
  assert.equal(url, 'https://api.orcarouter.ai/v1/chat/completions');
  assert.equal(body.model, 'orcarouter/auto');
  assert.equal(body.max_tokens, 1_024);
});

test('puts free routers ahead of direct providers by default', async () => {
  let url = '';
  const fetcher = (async (input: RequestInfo | URL) => {
    url = String(input);
    return chatResponse();
  }) as typeof fetch;

  await aiQuip(
    '{}',
    { OPENROUTER_API_KEY: 'router', OPENAI_API_KEY: 'openai' },
    fetcher,
  );
  assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
});

test('recognizes and disables router providers like direct providers', () => {
  assert.equal(hasAiProvider({ OPENROUTER_API_KEY: 'router' }), true);
  assert.equal(hasAiProvider({ ORCAROUTER_API_KEY: 'orca' }), true);
  assert.equal(
    hasAiProvider({ OPENROUTER_API_KEY: 'router', KANAREK_OPENROUTER_ENABLED: 'off' }),
    false,
  );
  assert.equal(
    hasAiProvider({ ORCAROUTER_API_KEY: 'orca', KANAREK_ORCAROUTER_ENABLED: 'false' }),
    false,
  );
});
