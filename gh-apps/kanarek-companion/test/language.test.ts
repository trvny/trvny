import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chinesePresetPool,
  contextLanguage,
  contextualPreset,
  latinPresetPool,
  matchesLanguage,
  presetPool,
  reusableQuip,
  russianPresetPool,
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

test('selects presets from normal or rare easter-egg language pools', async () => {
  for (const key of Object.keys(PRESETS)) {
    for (const language of ['pl', 'en'] as const) {
      const pools = [
        presetPool(key, language),
        chinesePresetPool(key),
        latinPresetPool(key),
        russianPresetPool(key),
      ];
      for (let index = 0; index < 20; index += 1) {
        const value = await contextualPreset(
          key,
          `${language}-${key}-${index}`,
          '',
          language,
        );
        assert.equal(
          pools.some((pool) => pool.includes(value)),
          true,
          `${key}/${language}: ${value}`,
        );
      }
    }
  }
});

test('keeps polyglot easter eggs deterministic and rare', async () => {
  assert.equal(
    chinesePresetPool('ready').includes(
      await contextualPreset('ready', 'egg-32', '', 'en'),
    ),
    true,
  );
  assert.equal(
    latinPresetPool('ready').includes(
      await contextualPreset('ready', 'egg-2', '', 'en'),
    ),
    true,
  );
  assert.equal(
    russianPresetPool('ready').includes(
      await contextualPreset('ready', 'egg-16', '', 'en'),
    ),
    true,
  );
  assert.equal(
    presetPool('ready', 'en').includes(
      await contextualPreset('ready', 'egg-0', '', 'en'),
    ),
    true,
  );
});

test('validates generated text before caching it by language', () => {
  assert.equal(matchesLanguage('Wszystko działa, można lecieć.', 'pl'), true);
  assert.equal(matchesLanguage('Everything works, cleared for takeoff.', 'en'), true);
  assert.equal(matchesLanguage('Wszystko działa, można lecieć.', 'en'), false);
  assert.equal(matchesLanguage('Everything works, cleared for takeoff.', 'pl'), false);
});

test('does not discard valid ASCII Polish paid quips', () => {
  const polish = 'Kanarek pilnuje zielonych lampek i spokojnie zamyka skrzynke.';
  const english = 'Kanarek checks green lights and quietly closes the toolbox.';
  assert.equal(matchesLanguage(polish, 'pl'), true);
  assert.equal(matchesLanguage(polish, 'en'), false);
  assert.equal(matchesLanguage(english, 'en'), true);
  assert.equal(matchesLanguage(english, 'pl'), false);
  assert.equal(reusableQuip(polish, 'pl'), polish);
  assert.equal(reusableQuip(english, 'en'), english);
});

test('rejects learned quips outside the shared quality contract', () => {
  assert.equal(reusableQuip('Za krótko.', 'pl'), null);
  assert.equal(reusableQuip('x'.repeat(111), 'en'), null);
  assert.equal(
    reusableQuip('Everything works, cleared for takeoff and ready to merge now.', 'pl'),
    null,
  );
});

test('treats weak language evidence as ambiguous', () => {
  const technical = 'CI 2026: PR #198 OK; status green; merge queue ready now.';
  assert.equal(matchesLanguage(technical, 'pl'), true);
  assert.equal(matchesLanguage(technical, 'en'), true);
  assert.equal(
    matchesLanguage('Everything works, green lights ready for takeoff.', 'pl'),
    false,
  );
});
