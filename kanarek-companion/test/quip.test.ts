import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { aiQuip, hash, PRESETS, sanitize } from '../src/quip.ts';

test('keeps the refreshed Kanarek preset bank', () => {
  assert.equal(
    PRESETS.ready.includes('Czytnik mruczy, Kanarek strzyże błędy, feed płynie.'),
    true,
  );
  assert.equal(
    PRESETS.waiting.includes(
      'Kanarek śledzi CI, aż kod zabulgotuje. Testy jeszcze mieszają.',
    ),
    true,
  );
  assert.equal(
    PRESETS.blocked.includes(
      'CI in dreamland: blockers hum while Kanarek naps through the blockade.',
    ),
    true,
  );
});

test('uses the same SHA-256 quip key format as the Actions backend', async () => {
  const value = { status: 'ready', blockers: [], area: 'Repo root', size: 'tiny' };
  const expected = createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
    .slice(0, 16);
  assert.equal(await hash(value), expected);
});

test('sanitizes generated quips before rendering', () => {
  assert.equal(
    sanitize('**hej** @user https://example.com\nOK'),
    'hej ＠user OK',
  );
});

test('gives OpenAI reasoning models enough output budget', async () => {
  let requestBody: Record<string, unknown> | null = null;
  const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return Response.json({
      output_text: 'Kanarek policzył lampki i wszystko świeci jak trzeba.',
    });
  }) as typeof fetch;

  const quip = await aiQuip(
    'status=ready; blockers=none; area=Repo root; size=tiny',
    {
      OPENAI_API_KEY: 'test',
      KANAREK_OPENAI_MODEL: 'gpt-5.6-luna',
      KANAREK_OPENAI_FALLBACK_MODEL: 'gpt-5.4-nano',
    },
    fetcher,
  );

  assert.ok(quip);
  assert.equal(requestBody?.max_output_tokens, 256);
});
