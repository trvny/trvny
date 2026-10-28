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

test('individual posts expose truthful BlogPosting schema and publication date', async () => {
  const response = await worker.fetch(new Request(post.url), {
    FEED: {
      get: async (key) => key === `posts/${post.id}.json`
        ? { json: async () => post }
        : null,
    },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  const match = html.match(/<head>[\s\S]*?<script type="application\/ld\+json">([^<]+)<\/script>[\s\S]*?<\/head>/);
  assert.ok(match, 'BlogPosting data must be inside the document head');
  const schema = JSON.parse(match[1]);
  assert.equal(schema['@type'], 'BlogPosting');
  assert.equal(schema['@id'], `${post.url}#post`);
  assert.equal(schema.mainEntityOfPage['@id'], post.url);
  assert.equal(schema.headline, 'deploy przeszedł. aplikacja nie.');
  assert.equal(schema.articleBody, post.content.text);
  assert.equal(schema.datePublished, post.published_at);
  assert.deepEqual(schema.author, {
    '@type': 'Organization',
    name: 'Shitpost Reactor',
    url: 'https://shitpost.trfny.com/',
  });
  assert.match(html, /<time datetime="2026-10-01T18:01:00.000Z">/);
});

test('sitemap includes every archived post without reading post bodies', async () => {
  const entries = Array.from({ length: 55 }, (_, index) => ({
    id: `gh-${1000 + index}-1`,
    published_at: new Date(Date.UTC(2026, 8, 1 + index)).toISOString(),
  }));
  const response = await worker.fetch(new Request('https://shitpost.trfny.com/sitemap.xml'), {
    FEED: {
      get: async (key) => {
        assert.equal(key, 'index.json', 'sitemap must not read post JSON objects');
        return { json: async () => entries, customMetadata: { archive_index_version: '2' } };
      },
    },
  });
  assert.equal(response.status, 200);
  const xml = await response.text();
  assert.equal((xml.match(/<loc>/g) ?? []).length, 57); // Home, archive, 55 posts.
  assert.match(xml, /<loc>https:\/\/shitpost\.trfny\.com\/posts\/gh-1000-1<\/loc>/);
  assert.match(xml, /<loc>https:\/\/shitpost\.trfny\.com\/posts\/gh-1054-1<\/loc>/);
});

test('homepage hides the description while retaining discovery metadata', async () => {
  const response = await worker.fetch(new Request('https://shitpost.trfny.com/'), {
    FEED: { get: () => null },
  });
  const html = await response.text();
  const body = html.slice(html.indexOf('<body>'));
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1]?.replace(/<!--[\s\S]*?-->/g, "");
  assert.ok(head, 'Verification metadata must be inside <head>');
  const metaTags = head.match(/<meta\b[^>]*>/gi) ?? [];
  const hasVerification = (name, content) => metaTags.some((tag) => {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/\s+(name|content)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
        .map(([, name, quoted, singleQuoted, bare]) => [name.toLowerCase(), quoted ?? singleQuoted ?? bare]),
    );
    return attributes.name?.toLowerCase() === name && attributes.content === content;
  });

  assert.match(html, /<title>Shitpost Reactor<\/title>/);
  assert.ok(hasVerification("msvalidate.01", "23A368B2C5F4DF3471A67EA6CB057149"), "Bing verification must be an active meta tag inside head");
  assert.ok(hasVerification("google-site-verification", "Qu5-7v2tWoKtUYUVlQXisaFkGGVEImYlmycKDUg0QBw"), "Google verification must be an active meta tag inside head");
  assert.match(html, /rel="describedby" href="\/llms\.txt"/);
  assert.match(html, /rel="manifest" href="\/site\.webmanifest"/);
  assert.match(html, /apple-touch-icon/);
  assert.match(html, /mask-icon/);
  assert.match(body, /<header><h1>Shitpost Reactor<\/h1><p class="feeds">/);
  assert.doesNotMatch(body, /Automatycznie generowane polskie shitposty/);
});

test('version endpoint exposes only a valid injected GitHub SHA', async () => {
  const sha = 'a'.repeat(40);
  const valid = await worker.fetch(new Request('https://shitpost.trfny.com/version'), { DEPLOY_COMMIT: sha });
  assert.equal(await valid.text(), `${sha}\n`);
  const unknown = await worker.fetch(new Request('https://shitpost.trfny.com/version'), {});
  assert.equal(await unknown.text(), 'unknown\n');
  const invalid = await worker.fetch(new Request('https://shitpost.trfny.com/version'), { DEPLOY_COMMIT: 'not-a-hash' });
  assert.equal(await invalid.text(), 'unknown\n');
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
  assert.ok(text.includes("https://shitpost-reactor.travny.workers.dev/atom.xml"));
  assert.ok(text.includes("https://shitpost-reactor.travny.workers.dev/feed.json"));
  assert.ok(text.includes("https://shitpost-reactor.travny.workers.dev/archive"));
  assert.match(text, /post IDs, feed metadata and sitemap entries still refer/);
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
