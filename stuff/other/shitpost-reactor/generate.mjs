import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { chooseMemeTemplate, memeImageUrl, resolveShitpostMode } from './templates.mjs';

export const DEFAULT_ENDPOINT = 'https://kanarek-companion.travny.workers.dev/review-router/v1/chat/completions';
export const DEFAULT_SKILL_URL = 'https://raw.githubusercontent.com/trvny/.ai/main/skills/edgy-dark-meme.zip';
export const DEFAULT_MODEL = 'kanarek-review-free';

const MAX_SKILL_ARCHIVE_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_BYTES = 256 * 1024;
const MAX_ERROR_BODY = 2_000;

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (readUInt32(buffer, offset) === signature) return offset;
  }
  throw new Error('skill_archive_missing_eocd');
}

export function extractZipEntry(buffer, targetName) {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = readUInt16(buffer, eocd + 10);
  let offset = readUInt32(buffer, eocd + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) {
      throw new Error('skill_archive_invalid_central_directory');
    }

    const method = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const uncompressedSize = readUInt32(buffer, offset + 24);
    const nameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');

    if (name === targetName) {
      if (uncompressedSize > MAX_SKILL_BYTES) throw new Error('skill_entry_too_large');
      if (readUInt32(buffer, localHeaderOffset) !== 0x04034b50) {
        throw new Error('skill_archive_invalid_local_header');
      }
      const localNameLength = readUInt16(buffer, localHeaderOffset + 26);
      const localExtraLength = readUInt16(buffer, localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      const result = method === 0
        ? Buffer.from(compressed)
        : method === 8
          ? inflateRawSync(compressed)
          : null;
      if (!result) throw new Error(`skill_archive_unsupported_method_${method}`);
      if (result.length !== uncompressedSize) throw new Error('skill_entry_size_mismatch');
      return result;
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`skill_entry_not_found:${targetName}`);
}

export async function loadSkill(skillUrl = DEFAULT_SKILL_URL, fetchImpl = fetch) {
  const response = await fetchImpl(skillUrl, {
    headers: { 'user-agent': 'trvny-shitpost-reactor/1' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`skill_download_failed:${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') || '0');
  if (declaredLength > MAX_SKILL_ARCHIVE_BYTES) throw new Error('skill_archive_too_large');
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length > MAX_SKILL_ARCHIVE_BYTES) throw new Error('skill_archive_too_large');
  return extractZipEntry(archive, 'SKILL.md').toString('utf8');
}

export function buildMessages(skill, topic = '', seed = '', mode = 'text', template = null) {
  const chosenTopic = topic.trim() || [
    'Wymyśl sam konkretny temat z codziennej technologii, pracy, polskiego internetu, biurokracji albo zwykłej życiowej porażki.',
    'Nie opieraj żartu na bieżącej wiadomości, której nie dostałeś w promptcie.',
  ].join(' ');

  const outputRule = mode === 'meme'
    ? `Zrób prosty klasyczny meme macro na gotowym template "${template?.name || template?.id || 'meme'}" (id: ${template?.id || 'unknown'}). Napisz tylko tekst nakładany na obraz. Zwróć wyłącznie JSON: {"kind":"meme","template":"${template?.id || 'unknown'}","top_text":"...","bottom_text":"..."}. Jedna z dwóch linii może być pusta, ale nie obie.`
    : 'Zwróć wyłącznie JSON: {"kind":"text","text":"..."}. Pole text ma być całym gotowym shitpostem i niczym więcej.';

  const rules = [
    'Tworzysz jeden oryginalny polski shitpost. Humor ma być szeroko rozumiany i zryty: absurdalny, internetowy, deadpan, antyhumorystyczny albo celowo głupi.',
    'Ma być śmieszne jako gotowy post, nie jako opis pomysłu. Nie tłumacz żartu, nie opisuj procesu i nie dodawaj etykiet typu dialekt, archetyp, format albo visual brief.',
    'Załączony skill jest wyłącznie dodatkowym źródłem inspiracji i wskazówek o tonie. Nie kopiuj jego schematu, nazw sekcji, dialektów, formatów ani archetypów. Jeśli jego struktura przeszkadza żartowi, zignoruj ją.',
    'Nie kopiuj istniejących postów ani catchphrase 1:1.',
    'Nie targetuj prywatnych osób ani nie wymyślaj faktycznie brzmiących oskarżeń.',
    'Nie twórz agitacji wyborczej ani rekomendacji politycznych. Jeśli pojawia się polityka, ma być oczywistą satyrą sytuacji lub publicznego dyskursu.',
    outputRule,
  ].join('\n');

  const system = [
    '## Shitpost Reactor rules',
    rules,
    '',
    '## Optional style reference',
    'Poniższy skill to materiał referencyjny, nie kontrakt odpowiedzi. Reguły Shitpost Reactora powyżej mają pierwszeństwo.',
    '<style_reference>',
    skill.trim(),
    '</style_reference>',
  ].join('\n');

  const user = [
    `TEMAT: ${chosenTopic}`,
    seed ? `SEED RUNU: ${seed}` : '',
    mode === 'meme' ? `TEMPLATE: ${template?.id || ''} / ${template?.name || ''}` : '',
    'Wybierz jeden konkretny detal i jedź. Bez wstępu, bez komentarza po żarcie.',
  ].filter(Boolean).join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function stripCodeFence(value) {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function boundedString(value, field, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw new Error(`content_invalid_${field}`);
  const result = value.trim();
  if (!allowEmpty && !result) throw new Error(`content_invalid_${field}`);
  if (result.length > maxLength) throw new Error(`content_invalid_${field}_length`);
  return result;
}

export function validateContent(value, { mode, templateId } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('content_not_object');
  }
  if (value.kind === 'text') {
    if (mode && mode !== 'text') throw new Error('content_unexpected_kind');
    return { kind: 'text', text: boundedString(value.text, 'text', 700) };
  }
  if (value.kind === 'meme') {
    if (mode && mode !== 'meme') throw new Error('content_unexpected_kind');
    const template = boundedString(value.template, 'template', 80);
    if (templateId && template !== templateId) throw new Error('content_unexpected_template');
    const topText = boundedString(value.top_text, 'top_text', 220, { allowEmpty: true });
    const bottomText = boundedString(value.bottom_text, 'bottom_text', 220, { allowEmpty: true });
    if (!topText && !bottomText) throw new Error('content_empty_meme_text');
    return { kind: 'meme', template, top_text: topText, bottom_text: bottomText };
  }
  throw new Error('content_invalid_kind');
}

export function parseContent(content, options = {}) {
  const cleaned = stripCodeFence(content);
  try {
    return validateContent(JSON.parse(cleaned), options);
  } catch (firstError) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw firstError;
    return validateContent(JSON.parse(cleaned.slice(start, end + 1)), options);
  }
}

export async function requestCompletion({ endpoint, token, messages, fetchImpl = fetch }) {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'trvny-shitpost-reactor/1',
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages,
      max_tokens: 900,
      stream: false,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, MAX_ERROR_BODY).replaceAll(token, '[redacted]');
    throw new Error(`router_failed:${response.status}:${body}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('router_missing_content');
  return {
    content,
    model: typeof payload.model === 'string' ? payload.model : DEFAULT_MODEL,
    provider: response.headers.get('x-kanarek-review-provider') || 'unknown',
  };
}

export function renderMarkdown(record) {
  const content = record.content;
  const body = content.kind === 'meme'
    ? [
        `![meme](${memeImageUrl(content.template, content.top_text, content.bottom_text)})`,
        '',
        [content.top_text, content.bottom_text].filter(Boolean).map((line) => `> ${line.replaceAll('\n', ' ')}`).join('\n'),
      ].join('\n')
    : `> ${content.text.replaceAll('\n', ' ')}`;

  return [
    '# Shitpost Reactor',
    '',
    body,
    '',
    `- **kind:** ${content.kind}`,
    `- **provider:** ${record.provider}`,
    `- **model:** ${record.model}`,
    `- **generated:** ${record.generated_at}`,
    '',
  ].join('\n');
}

export async function main() {
  const token = process.env.KANAREK_REVIEW_ROUTER_TOKEN?.trim();
  if (!token) throw new Error('KANAREK_REVIEW_ROUTER_TOKEN is required');

  const endpoint = process.env.KANAREK_REVIEW_ROUTER_URL?.trim() || DEFAULT_ENDPOINT;
  const skillUrl = process.env.EDGY_DARK_MEME_SKILL_URL?.trim() || DEFAULT_SKILL_URL;
  const topic = process.env.SHITPOST_TOPIC || '';
  const requestedMode = process.env.SHITPOST_MODE || 'auto';
  const seed = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT || '1'}`
    : new Date().toISOString().slice(0, 10);
  const outputDir = resolve(process.env.SHITPOST_OUTPUT_DIR || 'out');

  const skill = await loadSkill(skillUrl);
  const skillHash = createHash('sha256').update(skill).digest('hex');
  const mode = resolveShitpostMode(requestedMode, seed);
  const template = mode === 'meme' ? chooseMemeTemplate(seed) : null;
  const messages = buildMessages(skill, topic, seed, mode, template);
  const completion = await requestCompletion({ endpoint, token, messages });
  const content = parseContent(completion.content, { mode, templateId: template?.id });
  const record = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    provider: completion.provider,
    model: completion.model,
    skill: {
      source: skillUrl,
      sha256: skillHash,
    },
    topic: topic.trim() || null,
    content,
  };

  await mkdir(outputDir, { recursive: true });
  const json = `${JSON.stringify(record, null, 2)}\n`;
  const markdown = renderMarkdown(record);
  await writeFile(resolve(outputDir, 'latest.json'), json, 'utf8');
  await writeFile(resolve(outputDir, 'latest.md'), markdown, 'utf8');

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
  }

  process.stdout.write(`shitpost generated via ${record.provider}/${record.model}\n`);
  process.stdout.write(`artifact: ${resolve(outputDir, 'latest.json')}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
