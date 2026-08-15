import assert from 'node:assert/strict';
import test from 'node:test';

import { aiQuip } from '../src/quip.ts';

const VALID_QUIP = 'Kanarek checks the provider panel and finds every dial behaving.';

test('uses Grok 4.6 as the xAI default', async () => {
  let requestBody: Record<string, unknown> = {};
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return Response.json({ status: 'completed', output_text: VALID_QUIP });
  }) as typeof fetch;

  await aiQuip('{}', { XAI_API_KEY: 'xai' }, fetcher);

  assert.equal(requestBody.model, 'grok-4.6');
  assert.equal(requestBody.max_output_tokens, 1_024);
  assert.deepEqual(requestBody.reasoning, { effort: 'low' });
});

test('honors provider order and xAI request controls', async () => {
  let url = '';
  let requestBody: Record<string, unknown> = {};
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input);
    requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return Response.json({ status: 'completed', output_text: VALID_QUIP });
  }) as typeof fetch;

  const quip = await aiQuip(
    '{}',
    {
      OPENAI_API_KEY: 'openai',
      XAI_API_KEY: 'xai',
      KANAREK_PROVIDER_ORDER: 'xai,openai,openai-fallback,anthropic,gemini',
      KANAREK_XAI_MODEL: 'grok-4.6',
      KANAREK_XAI_MAX_OUTPUT_TOKENS: '768',
      KANAREK_XAI_REASONING: 'medium',
      KANAREK_XAI_PROMPT_CACHE_KEY: 'kanarek-test',
    },
    fetcher,
  );

  assert.equal(quip, VALID_QUIP);
  assert.equal(url, 'https://api.x.ai/v1/responses');
  assert.equal(requestBody.model, 'grok-4.6');
  assert.equal(requestBody.max_output_tokens, 768);
  assert.deepEqual(requestBody.reasoning, { effort: 'medium' });
  assert.equal(requestBody.prompt_cache_key, 'kanarek-test');
});

test('honors OpenAI output and reasoning controls', async () => {
  let requestBody: Record<string, unknown> = {};
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return Response.json({ status: 'completed', output_text: VALID_QUIP });
  }) as typeof fetch;

  await aiQuip(
    '{}',
    {
      OPENAI_API_KEY: 'openai',
      KANAREK_OPENAI_MODEL: 'gpt-5.6-luna',
      KANAREK_OPENAI_FALLBACK_MODEL: 'gpt-5.6-luna',
      KANAREK_OPENAI_MAX_OUTPUT_TOKENS: '333',
      KANAREK_OPENAI_REASONING: 'low',
    },
    fetcher,
  );

  assert.equal(requestBody.max_output_tokens, 333);
  assert.deepEqual(requestBody.reasoning, { effort: 'low' });
});

test('honors Anthropic and Gemini generation controls', async () => {
  let anthropicBody: Record<string, unknown> = {};
  const anthropicFetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    anthropicBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return Response.json({
      content: [{ type: 'text', text: VALID_QUIP }],
      stop_reason: 'end_turn',
    });
  }) as typeof fetch;

  await aiQuip(
    '{}',
    { ANTHROPIC_API_KEY: 'anthropic', KANAREK_ANTHROPIC_MAX_TOKENS: '444' },
    anthropicFetcher,
  );
  assert.equal(anthropicBody.max_tokens, 444);

  let geminiBody: Record<string, unknown> = {};
  const geminiFetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    geminiBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return Response.json({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ text: VALID_QUIP }] },
        },
      ],
    });
  }) as typeof fetch;

  await aiQuip(
    '{}',
    {
      GEMINI_API_KEY: 'gemini',
      KANAREK_GEMINI_MAX_OUTPUT_TOKENS: '555',
      KANAREK_GEMINI_THINKING_LEVEL: 'high',
    },
    geminiFetcher,
  );
  assert.deepEqual(geminiBody.generationConfig, {
    maxOutputTokens: 555,
    thinkingConfig: { thinkingLevel: 'high' },
  });
});
