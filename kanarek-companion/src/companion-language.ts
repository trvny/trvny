import { hash, PRESETS } from './quip.ts';

export type CompanionLanguage = 'en' | 'pl';

const POLISH_WORDS = new Set([
  'ale',
  'bez',
  'bo',
  'czy',
  'dla',
  'do',
  'dziala',
  'działa',
  'jest',
  'kanarka',
  'ma',
  'na',
  'napraw',
  'nie',
  'oraz',
  'po',
  'popraw',
  'przy',
  'sie',
  'się',
  'ten',
  'to',
  'usun',
  'usuń',
  'w',
  'z',
  'za',
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

export async function contextualPreset(
  key: string,
  seed: unknown,
  excluded = '',
  language: CompanionLanguage = 'en',
): Promise<string> {
  const options = PRESETS[key] ?? PRESETS.waiting;
  const matching = options.filter((option) => contextLanguage(option) === language);
  const languageOptions = matching.length ? matching : options;
  const alternatives = languageOptions.filter((option) => option !== excluded);
  const choices = alternatives.length ? alternatives : languageOptions;
  const digest = await hash(seed);
  const index = Number.parseInt(digest.slice(0, 8), 16) % choices.length;
  return choices[index];
}
