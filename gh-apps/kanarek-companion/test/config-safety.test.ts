import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  aiPercent,
  openAiReasoningEffort,
  QUIP_MODEL_DEFAULTS,
} from '../src/quip.ts';

const wranglerVars = (
  JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')) as {
    vars: Record<string, string>;
  }
).vars;

test('accepts only decimal integer AI percentages', () => {
  assert.equal(aiPercent({}), 25);
  assert.equal(aiPercent({ KANAREK_AI_PERCENT: '25' }), 25);
  assert.equal(aiPercent({ KANAREK_AI_PERCENT: ' 25 ' }), 25);
  assert.equal(aiPercent({ KANAREK_AI_PERCENT: '0' }), 0);
  assert.equal(aiPercent({ KANAREK_AI_PERCENT: '100' }), 100);
  assert.equal(aiPercent({ KANAREK_AI_PERCENT: '101' }), 100);

  for (const value of ['', '12.5', '0x19', '+25', '-1', '25oops', 'wat']) {
    assert.equal(aiPercent({ KANAREK_AI_PERCENT: value }), 0, value);
  }
});

test('quip model fallbacks match wrangler.jsonc', () => {
  for (const [name, fallback] of Object.entries(QUIP_MODEL_DEFAULTS)) {
    assert.equal(fallback, wranglerVars[name], name);
  }
});

test('configured OpenAI quip models always send an explicit reasoning effort', () => {
  // Without one the provider default applies and can eat the small quip
  // output budget; `auto` only knows the gpt-5.x and o-series families.
  for (const name of ['KANAREK_OPENAI_MODEL', 'KANAREK_OPENAI_FALLBACK_MODEL']) {
    assert.notEqual(
      openAiReasoningEffort(wranglerVars[name], wranglerVars.KANAREK_OPENAI_REASONING),
      null,
      name,
    );
  }
});
