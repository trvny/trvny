export const MEME_TEMPLATES = Object.freeze([
  { id: 'aag', name: 'Ancient Aliens Guy' },
  { id: 'afraid', name: 'Afraid to Ask Andy' },
  { id: 'bad', name: 'You Should Feel Bad' },
  { id: 'bender', name: "I'm Going to Build My Own Theme Park" },
  { id: 'bihw', name: "But It's Honest Work" },
  { id: 'buzz', name: 'X Everywhere' },
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

export function chooseMemeTemplate(seed = '') {
  return MEME_TEMPLATES[stableHash(`template:${seed}`) % MEME_TEMPLATES.length];
}

function memegenSegment(value) {
  const text = String(value || '').trim();
  if (!text) return '_';
  const escaped = text
    .replaceAll('-', '--')
    .replaceAll('_', '__')
    .replaceAll('?', '~q')
    .replaceAll('%', '~p')
    .replaceAll('#', '~h')
    .replaceAll('/', '~s')
    .replaceAll('\n', '~n')
    .replaceAll(' ', '_');
  return encodeURIComponent(escaped);
}

export function memeImageUrl(templateId, topText = '', bottomText = '') {
  const template = getMemeTemplate(templateId);
  if (!template) throw new Error('invalid_meme_template');
  return `https://api.memegen.link/images/${template.id}/${memegenSegment(topText)}/${memegenSegment(bottomText)}.webp`;
}
