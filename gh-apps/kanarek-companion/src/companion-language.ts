import {
  hash,
  PRESETS,
  sanitize,
  type QuipLanguage,
  validQuipLength,
} from './quip.ts';

export type CompanionLanguage = QuipLanguage;
type PrimaryLanguage = Extract<CompanionLanguage, 'en' | 'pl'>;

const CHINESE_EASTER_EGG_PERCENT = 3;
const LATIN_EASTER_EGG_PERCENT = 2;
const RUSSIAN_EASTER_EGG_PERCENT = 2;

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

const LATIN_PRESETS: Readonly<Record<string, readonly string[]>> = {
  ready: [
    'Lumina virent. Canaria instrumenta deponit; volatus permittitur.',
    'Fila quiescunt. Canaria caput inclinat: ad main procedendum est.',
  ],
  waiting: [
    'Machina adhuc laborat. Canaria funem custodit et responsum CI exspectat.',
    'Lumina adhuc cogitant. Canaria iuxta sedet nec bullas tangit.',
  ],
  blocked: [
    'Lumen rubrum ardet. Canaria vitium monstrat et auxilium humanum exspectat.',
    'Unus funis rebellat. Canaria volatum suspendit donec res componatur.',
  ],
  draft: [
    'Alae adhuc struuntur. Canaria non urget; schema manet in officina.',
    'Schema adhuc in cavea est. Canaria chartam inspicit et alarmum differt.',
  ],
  merged: [
    'In main iam appulit. Canaria libellum claudit: opus perfectum est.',
    'Codex ad nidum rediit. Canaria sigillum ponit et officium finit.',
  ],
  closed: [
    'Volatus cancellatus est. Canaria lucem extinguit et caveam ordinat.',
    'PR clausum est. Canaria micas verrit; cavea ad quietem redit.',
  ],
};

const RUSSIAN_PRESETS: Readonly<Record<string, readonly string[]>> = {
  ready: [
    'Всё зелёное. Канарейка убирает отвёртку и разрешает взлёт.',
    'Провода подозрительно тихие. Канарейка кивает: можно в main.',
  ],
  waiting: [
    'Машина ещё работает. Канарейка сторожит кабель и ждёт ответа CI.',
    'Лампочки ещё думают. Канарейка сидит рядом и кнопки пока не клюёт.',
  ],
  blocked: [
    'Красная лампа горит. Канарейка показывает на сбой и зовёт человека.',
    'Один кабель взбунтовался. Канарейка временно отменяет взлёт.',
  ],
  draft: [
    'Крылья ещё собирают. Канарейка не торопит, черновик остаётся в работе.',
    'Черновик ещё в клетке. Канарейка читает схему и пока не бьёт тревогу.',
  ],
  merged: [
    'Код уже в main. Канарейка закрывает блокнот: дело сделано.',
    'Код вернулся в гнездо. Канарейка ставит печать и уходит домой.',
  ],
  closed: [
    'Полёт отменён. Канарейка выключает свет и закрывает лавочку.',
    'PR закрыт. Канарейка сметает крошки, клетка возвращается в ожидание.',
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

const LATIN_WORDS = new Set([
  'adhuc',
  'ad',
  'canaria',
  'cavea',
  'claudit',
  'codex',
  'cum',
  'est',
  'et',
  'exspectat',
  'fila',
  'finit',
  'funem',
  'funis',
  'iam',
  'lumen',
  'lumina',
  'machina',
  'micas',
  'nidum',
  'non',
  'opus',
  'permittitur',
  'quiescunt',
  'redit',
  'sed',
  'sigillum',
  'vitium',
  'volatum',
  'volatus',
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

function latinScore(value: string): number {
  const tokens = value.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  return tokens.reduce(
    (score, token) => score + (LATIN_WORDS.has(token) ? 1 : 0),
    0,
  );
}

function detectedPrimaryLanguage(value: string): PrimaryLanguage {
  const { english, polish } = languageScores(value);
  return polish > english ? 'pl' : 'en';
}

function polyglotRoll(value: string): number {
  let valueHash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    valueHash ^= value.charCodeAt(index);
    valueHash = Math.imul(valueHash, 16_777_619);
  }
  return (valueHash >>> 0) % 100;
}

export function contextLanguage(value: string): CompanionLanguage {
  const roll = polyglotRoll(value);
  const chineseEnd = CHINESE_EASTER_EGG_PERCENT;
  const latinEnd = chineseEnd + LATIN_EASTER_EGG_PERCENT;
  const russianEnd = latinEnd + RUSSIAN_EASTER_EGG_PERCENT;
  if (roll < chineseEnd) return 'zh';
  if (roll < latinEnd) return 'la';
  if (roll < russianEnd) return 'ru';
  return detectedPrimaryLanguage(value);
}

export function chinesePresetPool(key: string): readonly string[] {
  const stateKey = PRESETS[key] ? key : 'waiting';
  return CHINESE_PRESETS[stateKey] ?? CHINESE_PRESETS.waiting;
}

export function latinPresetPool(key: string): readonly string[] {
  const stateKey = PRESETS[key] ? key : 'waiting';
  return LATIN_PRESETS[stateKey] ?? LATIN_PRESETS.waiting;
}

export function russianPresetPool(key: string): readonly string[] {
  const stateKey = PRESETS[key] ? key : 'waiting';
  return RUSSIAN_PRESETS[stateKey] ?? RUSSIAN_PRESETS.waiting;
}

export function presetPool(
  key: string,
  language: CompanionLanguage,
): readonly string[] {
  if (language === 'zh') return chinesePresetPool(key);
  if (language === 'la') return latinPresetPool(key);
  if (language === 'ru') return russianPresetPool(key);
  const stateKey = PRESETS[key] ? key : 'waiting';
  const options = PRESETS[stateKey] ?? PRESETS.waiting;
  const split = POLISH_PRESET_COUNTS[stateKey] ?? 0;
  return language === 'pl' ? options.slice(0, split) : options.slice(split);
}

export function matchesLanguage(
  value: string,
  language: CompanionLanguage,
): boolean {
  const han = /\p{Script=Han}/u.test(value);
  const cyrillic = /\p{Script=Cyrillic}/u.test(value);
  if (language === 'zh') return han && !cyrillic;
  if (language === 'ru') return cyrillic && !han;
  if (han || cyrillic) return false;

  const latin = latinScore(value);
  const { english, polish } = languageScores(value);
  if (language === 'la') return latin >= 2 && english <= 2 && polish <= 1;
  if (latin >= 2) return false;
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
