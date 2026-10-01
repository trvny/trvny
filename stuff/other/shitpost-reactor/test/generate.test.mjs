import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import {
  buildMessages,
  extractZipEntry,
  parseMeme,
  renderMarkdown,
  requestCompletion,
  validateMeme,
} from '../generate.mjs';

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

test('buildMessages embeds the skill and requests one JSON object', () => {
  const messages = buildMessages('# skill', 'Teams o 07:59', '123.1');
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /jeden najmocniejszy/);
  assert.match(messages[1].content, /Teams o 07:59/);
  assert.match(messages[1].content, /123\.1/);
});

test('parseMeme accepts a fenced JSON response', () => {
  const meme = parseMeme('```json\n{"dialect":"dzida-core","format":"fake-ui","caption":"deploy przeszedł. aplikacja nie.","visual":"okno błędu","alt_text":"proste okno błędu"}\n```');
  assert.equal(meme.format, 'fake-ui');
});

test('validateMeme rejects missing fields', () => {
  assert.throws(() => validateMeme({ caption: 'x' }), /meme_invalid_dialect/);
});

test('requestCompletion keeps provider metadata without exposing the token', async () => {
  const fakeFetch = (_url, init) => {
    assert.match(init.headers.authorization, /^Bearer /);
    return new Response(JSON.stringify({
      model: 'free-model',
      choices: [{ message: { content: '{"dialect":"shitpost","format":"deadpan-caption","caption":"x","visual":"y","alt_text":"z"}' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-kanarek-review-provider': 'groq' },
    });
  };
  const result = await requestCompletion({ endpoint: 'https://example.test', token: 'secret', messages: [], fetchImpl: fakeFetch });
  assert.equal(result.provider, 'groq');
  assert.equal(result.model, 'free-model');
});

test('renderMarkdown produces a compact reviewable artifact', () => {
  const output = renderMarkdown({
    generated_at: '2026-10-01T19:37:00.000Z',
    provider: 'openrouter',
    model: 'free-model',
    meme: { dialect: 'kajmak', format: 'shitpost-one-panel', caption: 'no i leci', visual: 'jpeg', alt_text: 'jpeg' },
  });
  assert.match(output, /> no i leci/);
  assert.match(output, /openrouter/);
});
