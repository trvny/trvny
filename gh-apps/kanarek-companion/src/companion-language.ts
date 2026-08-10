import { hash, PRESETS } from './quip.ts';

export type CompanionLanguage = 'en' | 'pl';

const POLISH_PRESET_COUNTS: Readonly<Record<string, number>> = {
  ready: 4,
  waiting: 5,
  blocked: 4,
  draft: 3,
  merged: 3,
  closed: 3,
};

const POLISH_WORDS = new Set([
  'ale',
  'bez',
  'bo',
  'czy',
  'dla',
  'do',
  'dodaj',
  'dodanie',
  'dziala',
  'działa',
  'jest',
  'kanarka',
  'ma',
  'na',
  'napraw',
  'naprawa',
  'nie',
  'oraz',
  'po',
  'popraw',
  'poprawka',
  'poprawki',
  'przy',
  'reakcja',
  'reakcji',
  'sie',
  'się',
  'ten',
  'to',
  'usun',
  'usuń',
  'w',
  'z',
  'za',
  'zaktualizuj',
  'zmian',
  'zmiana',
  'zmiany',
  'zmien',
  'zmień',
  'znowu',
  'że',
]);

const ENGLISH_WORDS = new Set([
  'add',
  'and',
  'branch',
  'change',
  'do',
  'fix',
  'for',
  'from',
  'in',
  'is',
  'of',
  'on',
  'pull',
  'reaction',
  'reactions',
  'remove',
  'request',
  'state',
  'the',
  'this',
  'to',
  'update',
  'when',
  'with',
]);

export function contextLanguage(value: string): CompanionLanguage {
  const text = value.toLowerCase();
  const tokens = text.match(/[\p{L}]+/gu) ?? [];
  let polish = (text.match(/[ąćęłńóśźż]/g) ?? []).length * 3;
  let english = 0;

  for (const token of tokens) {
    if (POLISH_WORDS.has(token)) polish += 1;
    if (ENGLISH_WORDS.has(token)) english += 1;
  }
  return polish > english ? 'pl' : 'en';
}

export function presetPool(
  key: string,
  language: CompanionLanguage,
): readonly string[] {
  const stateKey = PRESETS[key] ? key : 'waiting';
  const options = PRESETS[stateKey] ?? PRESETS.waiting;
  const split = POLISH_PRESET_COUNTS[stateKey] ?? 0;
  return language === 'pl' ? options.slice(0, split) : options.slice(split);
}

export function matchesLanguage(
  value: string,
  language: CompanionLanguage,
): boolean {
  return contextLanguage(value) === language;
}

export async function contextualPreset(
  key: string,
  seed: unknown,
  excluded = '',
  language: CompanionLanguage = 'en',
): Promise<string> {
  const options = presetPool(key, language);
  const alternatives = options.filter((option) => option !== excluded);
  const choices = alternatives.length ? alternatives : options;
  const digest = await hash(seed);
  const index = Number.parseInt(digest.slice(0, 8), 16) % choices.length;
  return choices[index];
}
