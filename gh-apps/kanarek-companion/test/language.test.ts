import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contextLanguage,
  contextualPreset,
  matchesLanguage,
  presetPool,
} from '../src/companion-language.ts';
import { PRESETS } from '../src/quip.ts';

test('detects Polish and English PR context', () => {
  assert.equal(contextLanguage('Napraw Kanarka, bo znowu nie działa'), 'pl');
  assert.equal(contextLanguage('napraw kanarka bo znowu nie dziala'), 'pl');
  assert.equal(contextLanguage('Poprawka reakcji Kanarka'), 'pl');
  assert.equal(contextLanguage('Add Kanarek PR reactions'), 'en');
  assert.equal(contextLanguage('Fix the worker when CI is blocked'), 'en');
  assert.equal(contextLanguage('Temporary production probe. Do not merge.'), 'en');
  assert.equal(contextLanguage('Dodaj to do banku'), 'pl');
});

test('keeps every preset state in explicit language pools', () => {
  for (const key of Object.keys(PRESETS)) {
    const polish = presetPool(key, 'pl');
    const english = presetPool(key, 'en');
    assert.ok(polish.length > 0, `${key}: missing Polish presets`);
    assert.ok(english.length > 0, `${key}: missing English presets`);
    assert.equal(polish.length + english.length, PRESETS[key].length);
    assert.equal(
      polish.some((value) => english.includes(value)),
      false,
      `${key}: overlapping language pools`,
    );
  }
  assert.equal(
    presetPool('ready', 'pl').includes(
      'Maszyna mruczy poprawnie. Kanarek kiwa dziobem.',
    ),
    true,
  );
  assert.equal(
    presetPool('ready', 'en').includes(
      'Maszyna mruczy poprawnie. Kanarek kiwa dziobem.',
    ),
    false,
  );
});

test('selects presets only from the requested language pool', async () => {
  for (const key of Object.keys(PRESETS)) {
    for (const language of ['pl', 'en'] as const) {
      const pool = presetPool(key, language);
      for (let index = 0; index < 20; index += 1) {
        const value = await contextualPreset(
          key,
          `${language}-${key}-${index}`,
          '',
          language,
        );
        assert.equal(pool.includes(value), true, `${key}/${language}: ${value}`);
      }
    }
  }
});

test('validates generated text before caching it by language', () => {
  assert.equal(matchesLanguage('Wszystko działa, można lecieć.', 'pl'), true);
  assert.equal(matchesLanguage('Everything works, cleared for takeoff.', 'en'), true);
  assert.equal(matchesLanguage('Wszystko działa, można lecieć.', 'en'), false);
  assert.equal(matchesLanguage('Everything works, cleared for takeoff.', 'pl'), false);
});
