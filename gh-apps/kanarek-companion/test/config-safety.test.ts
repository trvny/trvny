import assert from 'node:assert/strict';
import test from 'node:test';

import { aiPercent } from '../src/quip.ts';

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
