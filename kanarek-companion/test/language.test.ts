import assert from 'node:assert/strict';
import test from 'node:test';

import { contextLanguage, contextualPreset } from '../src/companion-language.ts';

test('detects Polish and English PR context', () => {
  assert.equal(contextLanguage('Napraw Kanarka, bo znowu nie działa'), 'pl');
  assert.equal(contextLanguage('napraw kanarka bo znowu nie dziala'), 'pl');
  assert.equal(contextLanguage('Add Kanarek PR reactions'), 'en');
  assert.equal(contextLanguage('Fix the worker when CI is blocked'), 'en');
});

test('uses English presets for English context', async () => {
  for (let index = 0; index < 20; index += 1) {
    const value = await contextualPreset('waiting', `english-${index}`, '', 'en');
    assert.equal(/[ąćęłńóśźż]/i.test(value), false, value);
  }
});

test('uses Polish presets for Polish context', async () => {
  for (let index = 0; index < 20; index += 1) {
    const value = await contextualPreset('waiting', `polish-${index}`, '', 'pl');
    assert.equal(/[ąćęłńóśźż]/i.test(value), true, value);
  }
});
