import { createHash } from 'node:crypto';
import { OUTPUT_LANGUAGES } from './languages.mjs';

export const BACON_IPSUM_URL = 'https://baconipsum.com/api/?type=meat-and-filler&sentences=2';
const FETCH_TIMEOUT_MS = 4_000;
const MAX_BACON_BYTES = 16_384;

// Bacon Ipsum itself is English-only. Select an ingredient from its response
// and produce a genuine local-language post without spending any model tokens.
const MEATS = Object.freeze([
  { pattern: /\bbacon\b/i, names: { pl: 'boczek', en: 'bacon', 'zh-Hans': '培根', ru: 'бекон' } },
  { pattern: /\bpastrami\b/i, names: { pl: 'pastrami', en: 'pastrami', 'zh-Hans': '熏牛肉', ru: 'пастрами' } },
  { pattern: /\bbrisket\b/i, names: { pl: 'mostek wołowy', en: 'brisket', 'zh-Hans': '牛腩', ru: 'грудинка' } },
  { pattern: /\b(sausage|andouille|kielbasa)\b/i, names: { pl: 'kiełbasa', en: 'sausage', 'zh-Hans': '香肠', ru: 'колбаса' } },
  { pattern: /\b(ribs|ribeye)\b/i, names: { pl: 'żeberka', en: 'ribs', 'zh-Hans': '排骨', ru: 'рёбрышки' } },
  { pattern: /\b(pork|ham|pig)\b/i, names: { pl: 'szynka', en: 'ham', 'zh-Hans': '火腿', ru: 'ветчина' } },
  { pattern: /\b(beef|steak|t-bone|sirloin)\b/i, names: { pl: 'wołowina', en: 'beef', 'zh-Hans': '牛肉', ru: 'говядина' } },
  { pattern: /\b(chicken|poultry)\b/i, names: { pl: 'kurczak', en: 'chicken', 'zh-Hans': '鸡肉', ru: 'курица' } },
  { pattern: /\b(turkey|turducken)\b/i, names: { pl: 'indyk', en: 'turkey', 'zh-Hans': '火鸡', ru: 'индейка' } },
  { pattern: /\b(meatball|burger|ground round)\b/i, names: { pl: 'kotlet', en: 'meatball', 'zh-Hans': '肉丸', ru: 'котлета' } },
]);

const LANGUAGE_RENDERERS = Object.freeze({
  pl: (meat) => 'Wyczerpano dzienny przydział myśli. Komisja awaryjna mianowała ' + meat + ' dyrektorem kreatywnym. Posiedzenie zakończyło się skwierczeniem.',
  en: (meat) => 'The thought budget is gone. ' + meat + ' has been appointed interim head of creativity. All complaints must now be filed in the frying pan.',
  'zh-Hans': (meat) => '今日创意配额耗尽。委员会任命了' + meat + '为临时创意总监，所有投诉一律交给平底锅。对外公告称此举将极大提升生产效率，然而唯一持续增长的绩效指标是油温。',
  ru: (meat) => 'Бюджет мыслей закончился. ' + meat + ' назначили временным директором по креативу. Все жалобы теперь принимаются на сковороде.',
});

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
  const requested = OUTPUT_LANGUAGES.findIndex((item) => item.code === languageCode);
  const languageIndex = requested >= 0 ? requested : seededByte(seed, 'bacon-language') % OUTPUT_LANGUAGES.length;
  const language = OUTPUT_LANGUAGES[languageIndex];
  const found = MEATS.filter((meat) => meat.pattern.test(source));
  const choices = found.length ? found : MEATS;
  const meat = choices[seededByte(seed, 'bacon-meat') % choices.length];
  return {
    content: { kind: 'text', text: LANGUAGE_RENDERERS[language.code](meat.names[language.code]) },
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
