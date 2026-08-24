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

test('occasionally selects generated quip languages deterministically', () => {
  assert.equal(contextLanguage('polyglot-44'), 'zh');
  assert.equal(contextLanguage('polyglot-18'), 'la');
  assert.equal(contextLanguage('polyglot-8'), 'ru');
  assert.equal(contextLanguage('polyglot-0'), 'en');
});

test('keeps every preset state in explicit language pools', () => {
  for (const key of Object.keys(PRESETS)) {
    const polish = presetPool(key, 'pl');
    const english = presetPool(key, 'en');
    const chinese = presetPool(key, 'zh');
    const latin = presetPool(key, 'la');
    const russian = presetPool(key, 'ru');
    assert.ok(polish.length > 0, `${key}: missing Polish presets`);
    assert.ok(english.length > 0, `${key}: missing English presets`);
    assert.ok(chinese.length > 0, `${key}: missing Chinese presets`);
    assert.ok(latin.length > 0, `${key}: missing Latin presets`);
    assert.ok(russian.length > 0, `${key}: missing Russian presets`);
    assert.equal(polish.length + english.length, PRESETS[key].length);
    assert.equal(chinese, chinesePresetPool(key));
    assert.equal(latin, latinPresetPool(key));
    assert.equal(russian, russianPresetPool(key));
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

test('selects fallback presets only from the chosen quip language', async () => {
  for (const key of Object.keys(PRESETS)) {
    for (const language of ['pl', 'en', 'zh', 'la', 'ru'] as const) {
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
  const chinese =
    '绿灯已经全部亮起，金丝雀收好工具，认真检查线路和测试结果，然后拍拍翅膀，宣布这次可以安全飞进main，不需要人类救援。';
  const latin =
    'Lumina virent et machina quiescit; canaria codicem claudit, opus perfectum est.';
  const russian =
    'Все лампы зелёные, канарейка убирает инструменты и спокойно разрешает взлёт.';

  assert.equal(matchesLanguage('Wszystko działa, można lecieć.', 'pl'), true);
  assert.equal(matchesLanguage('Everything works, cleared for takeoff.', 'en'), true);
  assert.equal(matchesLanguage('Wszystko działa, można lecieć.', 'en'), false);
  assert.equal(matchesLanguage('Everything works, cleared for takeoff.', 'pl'), false);
  assert.equal(matchesLanguage(chinese, 'zh'), true);
  assert.equal(matchesLanguage(latin, 'la'), true);
  assert.equal(matchesLanguage(russian, 'ru'), true);
  assert.equal(matchesLanguage(chinese, 'en'), false);
  assert.equal(matchesLanguage(russian, 'pl'), false);
  assert.equal(matchesLanguage(latin, 'en'), false);
  assert.equal(reusableQuip(chinese, 'zh'), chinese);
  assert.equal(reusableQuip(latin, 'la'), latin);
  assert.equal(reusableQuip(russian, 'ru'), russian);
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
