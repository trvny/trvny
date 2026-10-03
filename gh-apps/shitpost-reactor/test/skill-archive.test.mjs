import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractZipEntry, loadSkillFromCandidates } from '../generate.mjs';

// Minimal stored (method 0) ZIP with several entries.
function zipEntries(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBytes = Buffer.from(name);
    const body = Buffer.from(text);
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    nameBytes.copy(local, 30);
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBytes.copy(central, 46);
    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

test('extractZipEntry reads SKILL.md from a .skill package folder', () => {
  const archive = zipEntries([
    ['edgy-dark-meme/references/craft.md', 'craft'],
    ['edgy-dark-meme/SKILL.md', '# nested skill'],
  ]);
  assert.equal(extractZipEntry(archive, 'SKILL.md').toString('utf8'), '# nested skill');
});

test('extractZipEntry prefers the root SKILL.md and ignores deeper or macOS copies', () => {
  const archive = zipEntries([
    ['__MACOSX/SKILL.md', 'resource fork'],
    ['a/b/SKILL.md', 'too deep'],
    ['pkg/SKILL.md', 'nested'],
    ['SKILL.md', 'root'],
  ]);
  assert.equal(extractZipEntry(archive, 'SKILL.md').toString('utf8'), 'root');
  assert.throws(() => extractZipEntry(zipEntries([['a/b/SKILL.md', 'x']]), 'SKILL.md'), /skill_entry_not_found/);
});

test('loadSkillFromCandidates falls through missing archives and reports the winner', async () => {
  const archive = zipEntries([['edgy-dark-meme/SKILL.md', '# from zip']]);
  const fetchImpl = async (url) => url.endsWith('.zip')
    ? new Response(archive, { status: 200 })
    : new Response('nope', { status: 404 });
  const result = await loadSkillFromCandidates(
    ['https://x.test/a.skill', 'https://x.test/b.skill', 'https://x.test/c.zip'],
    fetchImpl,
  );
  assert.deepEqual(result, { skill: '# from zip', source: 'https://x.test/c.zip' });
  await assert.rejects(
    loadSkillFromCandidates(['https://x.test/a.skill'], fetchImpl),
    /skill_unavailable\[https:\/\/x\.test\/a\.skill:skill_download_failed:404\]/,
  );
});
