import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

test('digest archive is built with a canonical URL and sitemap', async () => {
  const html = await readFile(new URL('../astro/dist/przeglad/index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="canonical" href="https:\/\/travny\.pages\.dev\/przeglad\/"/);
  const sitemap = await readFile(new URL('../astro/dist/przeglad/sitemap.xml', import.meta.url), 'utf8');
  assert.match(sitemap, /<urlset/);
  const entries = (await readdir(new URL('../astro/src/content/digests/', import.meta.url))).filter((name) => name.endsWith('.md'));
  if (entries.length === 0) {
    assert.match(html, /Pierwsze publiczne wydanie/);
    assert.doesNotMatch(sitemap, /<url>/);
  }
});

test('featured project metadata remains in the canonical publication catalog', async () => {
  const posts = JSON.parse(await readFile(new URL('../site/teksty/posts.json', import.meta.url), 'utf8'));
  for (const slug of ['githubowa-kraina', 'token-worldcup']) {
    assert.equal(posts.find((post) => post.slug === slug)?.featured, true);
  }
});

// Future generated issues are public HTML, so reject chat-only markup and unsafe embeds.
test('digest files use dated names, ordinary Markdown, and direct source links', async () => {
  const directory = new URL('../astro/src/content/digests/', import.meta.url);
  for (const name of (await readdir(directory)).filter((file) => file.endsWith('.md'))) {
    assert.match(name, /^\d{4}-\d{2}-\d{2}\.md$/);
    const text = await readFile(new URL(name, directory), 'utf8');
    assert.doesNotMatch(text, /<\/?[a-zA-Z!][^>]*>/, `${name} contains raw HTML or a chat component`);
    assert.doesNotMatch(text, /(?:javascript|data):/i, `${name} contains an unsafe URL`);
    assert.match(text, /(?<!!)\[[^\]]+\]\(https?:\/\/[^)]+\)/, `${name} needs a direct source link`);
  }
});
