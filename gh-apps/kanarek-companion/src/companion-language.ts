import { hash, PRESETS, sanitize, validQuipLength } from './quip.ts';

export type CompanionLanguage = 'en' | 'pl';

const CHINESE_EASTER_EGG_PERCENT = 3;

const CHINESE_PRESETS: Readonly<Record<string, readonly string[]>> = {
  ready: [
    '绿灯全亮。金丝雀收起螺丝刀，准许起飞。',
    '线路安静得可疑。金丝雀点点头，main 在招手。',
  ],
  waiting: [
    '机器还在运转。金丝雀守着电缆，等 CI 回话。',
    '灯还在思考。金丝雀蹲在旁边，暂时不啄按钮。',
  ],
  blocked: [
    '红灯亮了。金丝雀盯着故障点，等待人类支援。',
    '有根电缆开始闹脾气。金丝雀宣布暂停起飞。',
  ],
  draft: [
    '还在装翅膀。金丝雀暂时不催，草稿继续施工。',
    '草稿还在笼子里。金丝雀看看图纸，决定先不报警。',
  ],
  merged: [
    '已经落进 main。金丝雀合上小本本，任务完成。',
    '代码回巢了。金丝雀盖个小章，然后下班。',
  ],
  closed: [
    '航班取消。金丝雀关灯收摊，今天就到这里。',
    'PR 已关闭。金丝雀扫走面包屑，笼子恢复待机。',
  ],
};

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

export function chinesePresetPool(key: string): readonly string[] {
  const stateKey = PRESETS[key] ? key : 'waiting';
  return CHINESE_PRESETS[stateKey] ?? CHINESE_PRESETS.waiting;
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
  const digest = await hash(seed);
  const chineseOptions = chinesePresetPool(key);
  const chinese =
    Number.parseInt(digest.slice(0, 8), 16) % 100 < CHINESE_EASTER_EGG_PERCENT;
  const options = chinese ? chineseOptions : presetPool(key, language);
  const alternatives = options.filter((option) => option !== excluded);
  const choices = alternatives.length ? alternatives : options;
  const indexSource = chinese ? digest.slice(8, 16) : digest.slice(0, 8);
  const index = Number.parseInt(indexSource, 16) % choices.length;
  return choices[index];
}
