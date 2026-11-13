import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = new URL('../site/teksty/githubowa-kraina/', import.meta.url);

test('atlas regions, cards and generated guide stay in sync', async () => {
  const data = JSON.parse(await readFile(new URL('atlas.json', root), 'utf8'));
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.equal(new Set(data.regions.map(region => region.id)).size, data.regions.length);
  for (const region of data.regions) {
    assert.ok(html.includes(`data-region="${region.id}"`));
    assert.ok(region.name && region.description && region.items.length);
    for (const item of region.items) {
      assert.ok(item.name && item.description);
      assert.equal(new URL(item.url).protocol, 'https:');
    }
    assert.equal(new URL(region.url).protocol, 'https:');
  }
  const cards = [...html.matchAll(/data-region="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(cards.sort(), data.regions.map(region => region.id).sort());
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/github-world-guide.mjs', import.meta.url)), '--check']);
});
