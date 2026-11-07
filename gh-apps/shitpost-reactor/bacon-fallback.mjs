import { createHash } from 'node:crypto';

export const BACON_IPSUM_URL = 'https://baconipsum.com/api/?type=meat-and-filler&sentences=2';
const FETCH_TIMEOUT_MS = 4_000;
const MAX_BACON_BYTES = 16_384;

// Bacon Ipsum itself is English-only. Select an ingredient from its response
// and produce a genuine local-language post without spending any model tokens.
const MEATS = Object.freeze([
  { pattern: /\bbacon\b/i, names: ['boczek', 'bacon', 'Speck', 'bacon', 'pancetta', 'bacon', 'бекон', 'ベーコン', '培根'] },
  { pattern: /\bpastrami\b/i, names: ['pastrami', 'pastrami', 'Pastrami', 'pastrami', 'pastrami', 'pastrami', 'пастрами', 'パストラミ', '熏牛肉'] },
  { pattern: /\bbrisket\b/i, names: ['mostek wołowy', 'brisket', 'Rinderbrust', 'poitrine de bœuf', 'pecho de res', 'punta di petto', 'грудинка', '牛バラ肉', '牛腩'] },
  { pattern: /\b(sausage|andouille|kielbasa)\b/i, names: ['kiełbasa', 'sausage', 'Wurst', 'saucisse', 'salchicha', 'salsiccia', 'колбаса', 'ソーセージ', '香肠'] },
  { pattern: /\b(ribs|ribeye)\b/i, names: ['żeberka', 'ribs', 'Rippchen', 'côtes', 'costillas', 'costine', 'рёбрышки', 'スペアリブ', '排骨'] },
  { pattern: /\b(pork|ham|pig)\b/i, names: ['szynka', 'ham', 'Schinken', 'jambon', 'jamón', 'prosciutto', 'ветчина', 'ハム', '火腿'] },
  { pattern: /\b(beef|steak|t-bone|sirloin)\b/i, names: ['wołowina', 'beef', 'Rindfleisch', 'bœuf', 'ternera', 'manzo', 'говядина', '牛肉', '牛肉'] },
  { pattern: /\b(chicken|poultry)\b/i, names: ['kurczak', 'chicken', 'Hähnchen', 'poulet', 'pollo', 'pollo', 'курица', '鶏肉', '鸡肉'] },
  { pattern: /\b(turkey|turducken)\b/i, names: ['indyk', 'turkey', 'Truthahn', 'dinde', 'pavo', 'tacchino', 'индейка', '七面鳥', '火鸡'] },
  { pattern: /\b(meatball|burger|ground round)\b/i, names: ['kotlet', 'meatball', 'Frikadelle', 'boulette', 'albóndiga', 'polpetta', 'котлета', 'ミートボール', '肉丸'] },
]);

const LANGUAGES = Object.freeze([
  { code: 'pl', render: (meat) => 'Wyczerpano dzienny przydział myśli. Komisja awaryjna mianowała ' + meat + ' dyrektorem kreatywnym. Posiedzenie zakończyło się skwierczeniem.' },
  { code: 'en', render: (meat) => 'The thought budget is gone. ' + meat + ' has been appointed interim head of creativity. All complaints must now be filed in the frying pan.' },
  { code: 'de', render: (meat) => 'Das Gedankenbudget ist aufgebraucht. ' + meat + ' übernimmt ab sofort die Leitung der Kreativabteilung. Beschwerden bitte direkt in die Pfanne.' },
  { code: 'fr', render: (meat) => 'Le budget des idées est épuisé. ' + meat + ' prend officiellement la direction de la créativité. Les réclamations vont directement à la poêle.' },
  { code: 'es', render: (meat) => 'Se agotó el presupuesto de ideas. ' + meat + ' acaba de asumir la dirección de creatividad. Todas las quejas deben presentarse en la sartén.' },
  { code: 'it', render: (meat) => 'Il bilancio delle idee è finito. ' + meat + ' è stato nominato direttore creativo ad interim. Ogni reclamo va presentato alla padella.' },
  { code: 'ru', render: (meat) => 'Бюджет мыслей закончился. ' + meat + ' назначили временным директором по креативу. Все жалобы теперь принимаются на сковороде.' },
  { code: 'ja', render: (meat) => '本日のアイデア予算は尽きました。代わりに' + meat + 'が臨時クリエイティブ部長に就任。苦情はフライパンまでお願いします。' },
  { code: 'zh-Hans', render: (meat) => '今日创意配额耗尽。委员会任命了' + meat + '为临时创意总监，所有投诉一律交给平底锅。' },
]);

export function baconFallbackEligible(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /^router_(fetch_failed:|deadline_exceeded$|missing_content$|retry_exhausted$)/.test(message)
    || /^router_failed:(?:402|408|425|429|5\d\d):/.test(message)
    || /^content_(?:invalid_|unexpected_|not_object$|empty_)/.test(message)
    || error instanceof SyntaxError;
}

function seededByte(seed, salt) {
  return createHash('sha256').update(salt + ':' + seed).digest()[0];
}

export function createBaconPost({ seed = '', source = '', offline = false, languageCode = '' } = {}) {
  const requested = LANGUAGES.findIndex((item) => item.code === languageCode);
  const languageIndex = requested >= 0 ? requested : seededByte(seed, 'bacon-language') % LANGUAGES.length;
  const language = LANGUAGES[languageIndex];
  const found = MEATS.filter((meat) => meat.pattern.test(source));
  const choices = found.length ? found : MEATS;
  const meat = choices[seededByte(seed, 'bacon-meat') % choices.length];
  return {
    content: { kind: 'text', text: language.render(meat.names[languageIndex]) },
    provider: offline ? 'bacon-offline' : 'baconipsum',
    model: 'bacon-fallback/' + language.code,
    language: language.code,
    fallback: true,
  };
}

async function readBoundedBaconJson(response) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BACON_BYTES) {
    throw new Error('bacon_body_too_large');
  }
  if (!response.body) throw new Error('bacon_missing_body');
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BACON_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('bacon_body_too_large');
    }
    chunks.push(Buffer.from(value));
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
}

export async function loadBaconFallback({ seed = '', languageCode = '', fetchImpl = fetch, signalFactory = AbortSignal.timeout } = {}) {
  try {
    const response = await fetchImpl(BACON_IPSUM_URL, {
      headers: { accept: 'application/json', 'user-agent': 'trvny-shitpost-reactor/1' },
      signal: signalFactory(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error('bacon_http_' + response.status);
    const data = await readBoundedBaconJson(response);
    if (!Array.isArray(data) || !data.length || typeof data[0] !== 'string'
      || !data[0].trim() || data[0].length > 10_000) {
      throw new Error('bacon_invalid_payload');
    }
    if (!MEATS.some((meat) => meat.pattern.test(data[0]))) {
      throw new Error('bacon_no_recognized_meat');
    }
    return createBaconPost({ seed, source: data[0], languageCode });
  } catch (error) {
    // This is a fallback for a fallback, not another external dependency.
    const reason = error instanceof Error ? error.name : 'unknown';
    process.stderr.write('bacon_api_unavailable:' + reason + '; using local ingredients\n');
    return createBaconPost({ seed, offline: true, languageCode });
  }
}

export async function generateWithBaconFallback({ generate, seed = '', languageCode = '', fetchImpl = fetch } = {}) {
  try {
    return { ...(await generate()), fallback: false };
  } catch (error) {
    if (!baconFallbackEligible(error)) throw error;
    const reason = error instanceof Error ? error.message.split(':').slice(0, 2).join(':') : 'unknown';
    process.stderr.write('bacon_fallback_triggered:' + reason + '\n');
    return loadBaconFallback({ seed, languageCode, fetchImpl });
  }
}
