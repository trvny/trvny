import { hash, PRESETS, sanitize, validQuipLength } from './quip.ts';

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
  'dziob',
  'dziób',
  'gotowe',
  'gotowy',
  'jest',
  'kabel',
  'kable',
  'kanarka',
  'kod',
  'lampka',
  'lampki',
  'lampek',
  'leciec',
  'lecieć',
  'ma',
  'maszyna',
  'mozna',
  'można',
  'mruczy',
  'na',
  'napraw',
  'naprawa',
  'nie',
  'oraz',
  'pilnuje',
  'po',
  'popraw',
  'poprawka',
  'poprawki',
  'przy',
  'ptak',
  'reakcja',
  'reakcji',
  'sie',
  'się',
  'skrzynka',
  'skrzynke',
  'skrzynkę',
  'spokojnie',
  'sprawdza',
  'swieci',
  'świeci',
  'ten',
  'testy',
  'to',
  'usun',
  'usuń',
  'w',
  'wszystko',
  'z',
  'za',
  'zaktualizuj',
  'zamyka',
  'zielone',
  'zielony',
  'zielonych',
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
  'bird',
  'blocked',
  'branch',
  'cables',
  'calm',
  'change',
  'checks',
  'cleared',
  'closes',
  'code',
  'do',
  'everything',
  'fix',
  'for',
  'from',
  'green',
  'in',
  'is',
  'lights',
  'machine',
  'of',
  'on',
  'pull',
  'quietly',
  'reaction',
  'reactions',
  'ready',
  'remove',
  'request',
  'state',
  'takeoff',
  'the',
  'this',
  'to',
  'toolbox',
  'update',
  'waiting',
  'when',
  'wiring',
  'with',
  'works',
]);

function languageScores(value: string): { english: number; polish: number } {
  const text = value.toLowerCase();
  const tokens = text.match(/[\p{L}]+/gu) ?? [];
  let polish = (text.match(/[ąćęłńóśźż]/g) ?? []).length * 3;
  let english = 0;

  for (const token of tokens) {
    if (POLISH_WORDS.has(token)) polish += 1;
    if (ENGLISH_WORDS.has(token)) english += 1;
  }
  return { english, polish };
}

export function contextLanguage(value: string): CompanionLanguage {
  const { english, polish } = languageScores(value);
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
  const { english, polish } = languageScores(value);
  if (Math.abs(polish - english) < 3) return true;
  return language === 'pl' ? polish > english : english > polish;
}

export function reusableQuip(
  value: unknown,
  language: CompanionLanguage,
): string | null {
  const quip = sanitize(value);
  return validQuipLength(quip) && matchesLanguage(quip, language) ? quip : null;
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
