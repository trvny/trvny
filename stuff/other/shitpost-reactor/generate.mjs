import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

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

export function buildMessages(skill, topic = '', seed = '') {
  const chosenTopic = topic.trim() || [
    'Wymyśl sam konkretny temat z codziennej technologii, pracy, polskiego internetu, biurokracji albo zwykłej życiowej porażki.',
    'Nie opieraj żartu na bieżącej wiadomości, której nie dostałeś w promptcie.',
  ].join(' ');

  const system = `${skill.trim()}\n\n## Automation overlay\n\n` + [
    'Tworzysz jeden najmocniejszy, oryginalny polski shitpost, nie trzy warianty.',
    'Wybierz najwyżej dwa dialekty ze skilla i jeden format archetypowy.',
    'To jest automatyczny draft do późniejszej publikacji, więc nie targetuj prywatnych osób, grup chronionych ani rozpoznawalnych ofiar świeżych tragedii.',
    'Nie wymyślaj faktycznie brzmiących oskarżeń. Nie twórz agitacji wyborczej ani rekomendacji politycznych. Jeśli pojawia się polityka, ma być oczywistą satyrą sytuacji lub publicznego dyskursu.',
    'Nie kopiuj istniejących postów, catchphrase ani konkretnego chronionego kadru. Visual ma działać jako oryginalna scena albo tani montaż.',
    'Zwróć wyłącznie jeden obiekt JSON, bez markdownu i bez komentarza.',
    'Pola: dialect, format, caption, visual, alt_text. Wszystkie wartości muszą być niepustymi stringami.',
    'caption ma być gotowym tekstem mema, najlepiej do 280 znaków. visual ma być krótką instrukcją renderu. alt_text ma opisywać obraz bez powtarzania całego żartu.',
  ].join('\n');

  const user = [
    `TEMAT: ${chosenTopic}`,
    seed ? `SEED RUNU: ${seed}` : '',
    'Nie tłumacz żartu. Punch word last. Jeśli temat jest zbyt szeroki, wybierz jeden konkretny detal i jedź.',
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

export function validateMeme(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('meme_not_object');
  }
  const keys = ['dialect', 'format', 'caption', 'visual', 'alt_text'];
  const result = {};
  for (const key of keys) {
    const raw = value[key];
    if (typeof raw !== 'string' || !raw.trim()) throw new Error(`meme_invalid_${key}`);
    result[key] = raw.trim();
  }
  if (result.caption.length > 700) throw new Error('meme_caption_too_long');
  if (result.visual.length > 2_000) throw new Error('meme_visual_too_long');
  if (result.alt_text.length > 1_000) throw new Error('meme_alt_text_too_long');
  return result;
}

export function parseMeme(content) {
  const cleaned = stripCodeFence(content);
  try {
    return validateMeme(JSON.parse(cleaned));
  } catch (firstError) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end <= start) throw firstError;
    return validateMeme(JSON.parse(cleaned.slice(start, end + 1)));
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
  const meme = record.meme;
  return [
    '# Shitpost Reactor',
    '',
    `> ${meme.caption.replaceAll('\n', ' ')}`,
    '',
    `- **dialekt:** ${meme.dialect}`,
    `- **format:** ${meme.format}`,
    `- **visual:** ${meme.visual}`,
    `- **alt:** ${meme.alt_text}`,
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
  const seed = process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT || '1'}`
    : new Date().toISOString().slice(0, 10);
  const outputDir = resolve(process.env.SHITPOST_OUTPUT_DIR || 'out');

  const skill = await loadSkill(skillUrl);
  const skillHash = createHash('sha256').update(skill).digest('hex');
  const messages = buildMessages(skill, topic, seed);
  const completion = await requestCompletion({ endpoint, token, messages });
  const meme = parseMeme(completion.content);
  const record = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    provider: completion.provider,
    model: completion.model,
    skill: {
      source: skillUrl,
      sha256: skillHash,
    },
    topic: topic.trim() || null,
    meme,
  };

  await mkdir(outputDir, { recursive: true });
  const json = `${JSON.stringify(record, null, 2)}\n`;
  const markdown = renderMarkdown(record);
  await writeFile(resolve(outputDir, 'latest.json'), json, 'utf8');
  await writeFile(resolve(outputDir, 'latest.md'), markdown, 'utf8');

  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown, 'utf8');
  }

  console.log(`shitpost generated via ${record.provider}/${record.model}`);
  console.log(`artifact: ${resolve(outputDir, 'latest.json')}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
