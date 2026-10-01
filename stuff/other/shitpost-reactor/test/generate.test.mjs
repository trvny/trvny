import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  buildMessages,
  extractZipEntry,
  parseContent,
  renderMarkdown,
  requestCompletion,
  validateContent,
} from '../generate.mjs';
import { chooseMemeTemplate, memeImageUrl, resolveShitpostMode } from '../templates.mjs';

function zipEntry(name, text, method = 0) {
  const nameBytes = Buffer.from(name);
  const body = Buffer.from(text);
  const compressed = method === 8 ? deflateRawSync(body) : body;
  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  nameBytes.copy(local, 30);

  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(body.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  nameBytes.copy(central, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, eocd]);
}

test('extractZipEntry reads the canonical SKILL.md entry', () => {
  const archive = zipEntry('SKILL.md', '# skill\nhello');
  assert.equal(extractZipEntry(archive, 'SKILL.md').toString('utf8'), '# skill\nhello');
});

test('extractZipEntry inflates a deflated SKILL.md entry', () => {
  const archive = zipEntry('SKILL.md', '# compressed skill\nhello', 8);
  assert.equal(extractZipEntry(archive, 'SKILL.md').toString('utf8'), '# compressed skill\nhello');
});

test('buildMessages treats the skill as advice instead of an output schema', () => {
  const messages = buildMessages('# skill\nDIALECT: dzida-core', 'Teams o 07:59', '123.1', 'text');
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /wyłącznie dodatkowym źródłem inspiracji/);
  assert.match(messages[0].content, /zryty/);
  assert.match(messages[0].content, /absurdalny/);
  assert.match(messages[0].content, /"kind":"text"/);
  assert.doesNotMatch(messages[0].content, /Wybierz najwyżej dwa dialekty/);
  assert.match(messages[1].content, /Teams o 07:59/);
});

test('buildMessages pins a meme template and asks only for overlay text', () => {
  const template = chooseMemeTemplate('123.1');
  const messages = buildMessages('# skill', 'deploy', '123.1', 'meme', template);
  assert.match(messages[0].content, new RegExp(`"template":"${template.id}"`));
  assert.match(messages[0].content, /top_text/);
  assert.doesNotMatch(messages[0].content, /visual brief/i);
});

test('parseContent accepts a text shitpost', () => {
  const content = parseContent('{"kind":"text","text":"deploy przeszedł. aplikacja nie."}', { mode: 'text' });
  assert.deepEqual(content, { kind: 'text', text: 'deploy przeszedł. aplikacja nie.' });
});

test('validateContent accepts a pinned meme and rejects invented templates', () => {
  const content = validateContent({
    kind: 'meme',
    template: 'bad',
    top_text: 'deploy przeszedł',
    bottom_text: 'aplikacja nie',
  }, { mode: 'meme', templateId: 'bad' });
  assert.equal(content.template, 'bad');
  assert.throws(
    () => validateContent({ ...content, template: 'whatever' }, { mode: 'meme', templateId: 'bad' }),
    /content_unexpected_template/,
  );
});

test('mode and template choices are deterministic', () => {
  assert.equal(resolveShitpostMode('text', 'anything'), 'text');
  assert.equal(resolveShitpostMode('meme', 'anything'), 'meme');
  assert.equal(resolveShitpostMode('auto', 'same-seed'), resolveShitpostMode('auto', 'same-seed'));
  assert.equal(chooseMemeTemplate('same-seed').id, chooseMemeTemplate('same-seed').id);
});

test('memeImageUrl produces a stateless image URL', () => {
  const url = memeImageUrl('bad', 'góra?', 'dół / dalej');
  assert.match(url, /^https:\/\/api\.memegen\.link\/images\/bad\//);
  assert.match(url, /\.webp$/);
});

test('requestCompletion keeps provider metadata without exposing the token', async () => {
  const fakeFetch = (_url, init) => {
    assert.match(init.headers.authorization, /^Bearer /);
    return new Response(JSON.stringify({
      model: 'free-model',
      choices: [{ message: { content: '{"kind":"text","text":"x"}' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-kanarek-review-provider': 'groq' },
    });
  };
  const result = await requestCompletion({
    endpoint: 'https://example.test',
    token: 'secret',
    messages: [],
    fetchImpl: fakeFetch,
  });
  assert.equal(result.provider, 'groq');
  assert.equal(result.model, 'free-model');
});

test('renderMarkdown produces a compact text artifact', () => {
  const output = renderMarkdown({
    generated_at: '2026-10-01T19:37:00.000Z',
    provider: 'openrouter',
    model: 'free-model',
    content: { kind: 'text', text: 'no i leci' },
  });
  assert.match(output, /> no i leci/);
  assert.match(output, /openrouter/);
});

test('renderMarkdown embeds the rendered meme URL', () => {
  const output = renderMarkdown({
    generated_at: '2026-10-01T19:37:00.000Z',
    provider: 'groq',
    model: 'free-model',
    content: { kind: 'meme', template: 'bihw', top_text: 'nie dużo', bottom_text: 'ale deploy' },
  });
  assert.match(output, /api\.memegen\.link/);
  assert.match(output, /kind:\*\* meme/);
});
