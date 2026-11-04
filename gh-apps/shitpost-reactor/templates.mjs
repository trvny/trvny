export const MEME_TEMPLATES = Object.freeze([
  { id: 'aag', name: 'Ancient Aliens Guy' },
  { id: 'ackbar', name: "It's a Trap!" },
  { id: 'afraid', name: 'Afraid to Ask Andy' },
  { id: 'agnes', name: 'Agnes Harkness Winking' },
  { id: 'aint-got-time', name: 'Sweet Brown' },
  { id: 'ams', name: 'Awkward Moment Seal' },
  { id: 'ants', name: 'Do You Want Ants?' },
  { id: 'atis', name: 'And Then I Said' },
  { id: 'away', name: 'Life Finds a Way' },
  { id: 'awesome', name: 'Socially Awesome Penguin' },
  { id: 'awesome-awkward', name: 'Awesome Awkward Penguin' },
  { id: 'awkward', name: 'Socially Awkward Penguin' },
  { id: 'awkward-awesome', name: 'Awkward Awesome Penguin' },
  { id: 'bad', name: 'You Should Feel Bad' },
  { id: 'badchoice', name: 'Milk Was a Bad Choice' },
  { id: 'bd', name: 'Butthurt Dweller' },
  { id: 'bender', name: "I'm Going to Build My Own Theme Park" },
  { id: 'bihw', name: "But It's Honest Work" },
  { id: 'buzz', name: 'X Everywhere' },
  { id: 'both', name: 'Why Not Both' },
  { id: 'rollsafe', name: 'Roll Safe' },
]);

const TEMPLATE_MAP = new Map(MEME_TEMPLATES.map((template) => [template.id, template]));

export function getMemeTemplate(id) {
  return TEMPLATE_MAP.get(String(id || '').trim()) || null;
}

function stableHash(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value || 'shitpost')) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function resolveShitpostMode(rawMode = 'auto', seed = '') {
  const mode = String(rawMode || 'auto').trim().toLowerCase();
  if (mode === 'text' || mode === 'meme') return mode;
  if (mode !== 'auto') throw new Error('invalid_shitpost_mode');
  return stableHash(seed) % 2 === 0 ? 'text' : 'meme';
}

const FONTS = Object.freeze(['impact', 'notosans', 'kalam', 'titilliumweb']);
const COLORS = Object.freeze(['white,black', 'yellow,black', 'black,white']);
const LAYOUTS = Object.freeze(['default', 'top']);

export function normalizeMemeLook(look = {}) {
  if (!look || typeof look !== 'object' || Array.isArray(look)) throw new Error('invalid_meme_look');
  const result = {};
  if (look.font !== undefined) {
    if (!FONTS.includes(look.font)) throw new Error('invalid_meme_font');
    result.font = look.font;
  }
  if (look.color !== undefined) {
    if (!COLORS.includes(look.color)) throw new Error('invalid_meme_color');
    result.color = look.color;
  }
  if (look.layout !== undefined) {
    if (!LAYOUTS.includes(look.layout)) throw new Error('invalid_meme_layout');
    result.layout = look.layout;
  }
  return result;
}

export function chooseMemeLook(seed = '') {
  const font = FONTS[stableHash('font:' + seed) % FONTS.length];
  const color = stableHash('color:' + seed) % 4 === 0
    ? COLORS[stableHash('palette:' + seed) % COLORS.length] : undefined;
  const layout = stableHash('layout:' + seed) % 5 === 0 ? 'top' : undefined;
  return normalizeMemeLook({ font, ...(color ? { color } : {}), ...(layout ? { layout } : {}) });
}

export function chooseMemeTemplate(seed = '') {
  return MEME_TEMPLATES[stableHash(`template:${seed}`) % MEME_TEMPLATES.length];
}

function memegenSegment(value) {
  const text = String(value || '').trim();
  if (!text) return '_';
  // memegen has no escape for a literal '~', so swap it for a lookalike before
  // the '~x' escape sequences below are introduced.
  const escaped = text
    .replaceAll('~', '\u223c')
    .replaceAll('-', '--')
    .replaceAll('_', '__')
    .replaceAll('?', '~q')
    .replaceAll('&', '~a')
    .replaceAll('%', '~p')
    .replaceAll('#', '~h')
    .replaceAll('/', '~s')
    .replaceAll('\\', '~b')
    .replaceAll('<', '~l')
    .replaceAll('>', '~g')
    .replaceAll('"', "''")
    .replaceAll('\n', '~n')
    .replaceAll(' ', '_');
  return encodeURIComponent(escaped);
}

export function memeImageUrl(templateId, topText = '', bottomText = '', look = {}) {
  const template = getMemeTemplate(templateId);
  if (!template) throw new Error('invalid_meme_template');
  const top = memegenSegment(topText);
  const bottom = memegenSegment(bottomText);
  if (top.length > 190 || bottom.length > 190) throw new Error('meme_caption_url_too_long');
  const url = new URL(`https://api.memegen.link/images/${template.id}/${top}/${bottom}.webp`);
  const options = normalizeMemeLook(look);
  for (const [key, value] of Object.entries(options)) url.searchParams.set(key, value);
  return url.toString();
}
