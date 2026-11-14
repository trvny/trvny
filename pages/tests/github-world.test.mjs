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
  const explorer = await readFile(new URL('explore.js', root), 'utf8');
  const generator = await readFile(new URL('../scripts/github-world-guide.mjs', import.meta.url), 'utf8');
  assert.ok(explorer.trim(), 'atlas interaction script is empty');
  assert.ok(generator.trim(), 'atlas guide generator is empty');
  assert.equal(new Set(data.regions.map(region => region.id)).size, data.regions.length);
  for (const region of data.regions) {
    const card = [...html.matchAll(/<a\b[^>]*data-region="([^"]+)"[^>]*>/g)]
      .find(match => match[1] === region.id)?.[0];
    assert.ok(card);
    assert.ok(card.includes(`href="${region.url}"`));
    assert.ok(region.name && region.description && region.items.length);
    for (const item of region.items) {
      assert.ok(item.name && item.description);
      assert.equal(new URL(item.url).protocol, 'https:');
    }
    assert.equal(new URL(region.url).protocol, 'https:');
  }
  const cards = [...html.matchAll(/data-region="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(cards.sort(), data.regions.map(region => region.id).sort());
  assert.ok(html.includes(`<strong>${data.regions.length}</strong><span>regions to explore</span>`));
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/github-world-guide.mjs', import.meta.url)), '--check']);
});


test('all language dictionaries cover the atlas without duplicating destinations', async () => {
  const catalog = JSON.parse(await readFile(new URL('atlas.json', root), 'utf8'));
  const locales = JSON.parse(await readFile(new URL('locales.json', root), 'utf8'));
  const html = await readFile(new URL('index.html', root), 'utf8');
  const languages = ['pl', 'en', 'ru', 'zh'];
  assert.deepEqual(Object.keys(locales).sort(), [...languages].sort());
  const keys = Object.keys(locales.en).sort();
  for (const language of languages) {
    assert.deepEqual(Object.keys(locales[language]).sort(), keys, `${language} UI keys`);
    assert.deepEqual(Object.keys(locales[language].cards).sort(), catalog.regions.filter(region => region.id !== 'workshop').map(region => region.id).sort());
    assert.deepEqual(Object.keys(locales[language].tags).sort(), Object.keys(locales[language].cards).sort());
    assert.equal(locales[language].lore.length, 5);
    assert.equal(locales[language].nav.length, 16);
    assert.match(html, new RegExp(`data-language="${language}"`));
    for (const [key, value] of Object.entries(locales[language])) {
      if (typeof value === 'string') assert.ok(value.trim(), `${language}.${key}`);
    }
  }
  for (const region of catalog.regions) {
    for (const language of ['pl', 'ru', 'zh']) {
      assert.ok(region.translations?.[language]?.description, `${region.id}.${language}`);
      for (const item of region.items) {
        assert.ok(item.translations?.[language]?.name, `${region.id}.${language} item name`);
        assert.ok(item.translations?.[language]?.description, `${region.id}.${language} item description`);
        assert.equal(item.translations[language].url, undefined);
      }
    }
  }
});
