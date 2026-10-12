import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { renderAtom, renderJsonFeed, renderRss } from '../worker.mjs';
import { ICON_SVG, renderIco, renderPng } from '../icons.mjs';

const post = {
  id: 'gh-123-1',
  generated_at: '2026-10-01T18:00:00.000Z',
  published_at: '2026-10-01T18:01:00.000Z',
  url: 'https://shitpost.trfny.com/posts/gh-123-1',
  provider: 'openrouter',
  model: 'free-model',
  skill: { source: 'https://example.test/skill.zip', sha256: 'abc' },
  topic: null,
  schema_version: 2,
  content: { kind: 'text', text: 'deploy przeszedł. aplikacja nie.' },
};

test('feed title drops the trvny prefix and feeds carry icon metadata', () => {
  const rss = renderRss([post]);
  const atom = renderAtom([post]);
  const json = JSON.parse(renderJsonFeed([post]));

  assert.match(rss, /<title>Shitpost Reactor<\/title>/);
  assert.match(rss, /<image>[\s\S]*favicon-96x96\.png/);
  assert.match(atom, /<title>Shitpost Reactor<\/title>/);
  assert.match(atom, /<icon>https:\/\/shitpost\.trfny\.com\/favicon\.svg<\/icon>/);
  assert.match(atom, /<logo>https:\/\/shitpost\.trfny\.com\/icon-512\.png<\/logo>/);
  assert.equal(json.title, 'Shitpost Reactor');
  assert.equal(json.favicon, 'https://shitpost.trfny.com/favicon-32x32.png');
  assert.equal(json.icon, 'https://shitpost.trfny.com/icon-512.png');
});

test('homepage hides the description while retaining discovery metadata', async () => {
  const response = await worker.fetch(new Request('https://shitpost.trfny.com/'), {
    FEED: { get: () => null },
  });
  const html = await response.text();
  const body = html.slice(html.indexOf('<body>'));

  assert.match(html, /<title>Shitpost Reactor<\/title>/);
  assert.match(html, /rel="describedby" href="\/llms\.txt"/);
  assert.match(html, /rel="manifest" href="\/site\.webmanifest"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /mask-icon/);
  assert.match(body, /<header><h1>Shitpost Reactor<\/h1><p class="feeds">/);
  assert.doesNotMatch(body, /Automatycznie generowane polskie shitposty/);
});

test('robots policy explicitly welcomes AI crawlers and everyone else', async () => {
  const response = await worker.fetch(new Request('https://shitpost.trfny.com/robots.txt'), {});
  const text = await response.text();

  assert.match(text, /User-agent: GPTBot/);
  assert.match(text, /User-agent: ChatGPT-User/);
  assert.match(text, /User-agent: ClaudeBot/);
  assert.match(text, /User-agent: PerplexityBot/);
  assert.match(text, /User-agent: Google-Extended/);
  assert.match(text, /User-agent: Applebot-Extended/);
  assert.match(text, /User-agent: \*\nContent-Signal: ai-train=yes, search=yes, ai-input=yes\nAllow: \//);
  assert.match(text, /Sitemap: https:\/\/shitpost\.trfny\.com\/sitemap\.xml/);
});

test('llms.txt exposes canonical feeds and discovery routes', async () => {
  const response = await worker.fetch(new Request('https://shitpost.trfny.com/llms.txt'), {});
  const text = await response.text();

  assert.match(text, /^# Shitpost Reactor/m);
  assert.match(text, /RSS 2\.0/);
  assert.match(text, /Atom 1\.0/);
  assert.match(text, /JSON Feed 1\.1/);
  assert.match(text, /Robots policy/);
  assert.match(text, /site\.webmanifest/);
});

test('web manifest propagates raster, SVG and maskable icons', async () => {
  const response = await worker.fetch(new Request('https://shitpost.trfny.com/site.webmanifest'), {});
  const manifest = JSON.parse(await response.text());

  assert.equal(manifest.name, 'Shitpost Reactor');
  assert.equal(manifest.theme_color, '#111111');
  assert.ok(manifest.icons.some((icon) => icon.src === '/favicon.svg' && icon.sizes === 'any'));
  assert.ok(manifest.icons.some((icon) => icon.src === '/icon-192.png'));
  assert.ok(manifest.icons.some((icon) => icon.src === '/icon-512.png'));
  assert.ok(manifest.icons.some((icon) => icon.src === '/icon-512-maskable.png' && icon.purpose === 'maskable'));
});

test('generated favicon formats have valid signatures', () => {
  assert.match(ICON_SVG, /^<svg/);
  assert.deepEqual(Array.from(renderPng(32).slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual(Array.from(renderIco(32).slice(0, 6)), [0, 0, 1, 0, 1, 0]);
});

test('full archive reads one bounded R2 page and navigates with an opaque cursor', async () => {
  const rows = Array.from({ length: 28 }, (_, i) => ({
    key: `posts/gh-${100 + i}-1.json`,
    uploaded: new Date(Date.UTC(2026, 9, i + 1)),
  }));
  const listArgs = [];
  let reads = 0;
  const env = { FEED: {
    async list(options) {
      listArgs.push(options);
      const start = options.cursor === 'next+token/=' ? 25 : 0;
      const objects = rows.slice(start, start + options.limit);
      return {
        objects,
        truncated: start + options.limit < rows.length,
        cursor: start === 0 ? 'next+token/=' : undefined,
      };
    },
    async get(key) {
      reads++;
      const entry = rows.find((row) => row.key === key);
      if (!entry) return null;
      const id = key.slice('posts/'.length, -'.json'.length);
      return { json: async () => ({ ...post, id, url: `https://shitpost.trfny.com/posts/${id}`, published_at: entry.uploaded.toISOString() }) };
    },
  } };
  const first = await worker.fetch(new Request('https://shitpost.trfny.com/archive'), env);
  const firstHtml = await first.text();
  assert.equal(first.status, 200);
  assert.match(firstHtml, /Oldest first/);
  assert.match(firstHtml, /archive\?cursor=next%2Btoken%2F%3D/);
  assert.match(firstHtml, /posts\/gh-100-1/);
  assert.doesNotMatch(firstHtml, /posts\/gh-127-1/);
  assert.deepEqual(listArgs[0], { prefix: 'posts/', limit: 25 });
  assert.equal(reads, 25);

  // New publication does not shift the boundary of an already browsed page.
  rows.push({ key: 'posts/gh-128-1.json', uploaded: new Date(Date.UTC(2026, 9, 29)) });
  const second = await worker.fetch(new Request('https://shitpost.trfny.com/archive?cursor=next%2Btoken%2F%3D'), env);
  const secondHtml = await second.text();
  assert.equal(second.status, 200);
  assert.match(secondHtml, /posts\/gh-125-1/);
  assert.match(secondHtml, /posts\/gh-128-1/);
  assert.doesNotMatch(secondHtml, /posts\/gh-124-1/);
  assert.deepEqual(listArgs[1], { prefix: 'posts/', limit: 25, cursor: 'next+token/=' });
  assert.equal(reads, 29);
  assert.doesNotMatch(secondHtml, /Next 25/);

  for (const cursor of ['', 'x'.repeat(2049), '\n']) {
    const invalid = await worker.fetch(new Request(`https://shitpost.trfny.com/archive?cursor=${encodeURIComponent(cursor)}`), env);
    assert.equal(invalid.status, 400);
  }
  assert.equal(listArgs.length, 2);
});
