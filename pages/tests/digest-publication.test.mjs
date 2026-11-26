import test from 'node:test';
import assert from 'node:assert/strict';
import { getDigestPosts } from '../functions/_shared/digests.js';
import { onRequest as home } from '../functions/index.js';
import { onRequest as texts } from '../functions/teksty/index.js';
import { onRequestGet as feed } from '../functions/teksty/feed.xml.js';

const posts = [
  { slug: 'old', title: 'Older text', summary: 'Old summary', date: '2026-01', updated: '2026-01-01T00:00:00Z', kind: 'TEXT', tags: [], lang: 'en' },
  { slug: 'token-worldcup', title: 'Token World Cup', titleLang: 'pl', summary: 'Featured', date: '2025-01', updated: '2025-01-01T00:00:00Z', kind: 'TEXT', tags: [], lang: 'en', featured: true },
  { slug: '../broken', title: 'Broken slug', summary: 'Invalid URL', date: '2024-01', updated: '2024-01-01T00:00:00Z', kind: 'TEXT', tags: [] },
];
const issues = [
  { id: '2026-11-02', title: 'News & <more>', description: 'Latest issue', date: '2026-11-02T00:00:00.000Z', updated: '2026-11-03T09:00:00.000Z' },
  { id: '../bad', title: 'Invalid', description: 'Bad slug', date: '2026-11-02T00:00:00.000Z' },
];
function context(path = '/') {
  return {
    request: new Request(`https://bartek.lol${path}`),
    env: { ASSETS: { fetch: (url) => {
      if (url instanceof Request) return Promise.resolve(new Response('<html><head></head><body><div id="text-list"></div><nav class="fastext"></nav></body></html>', { headers: { 'content-type': 'text/html' } }));
      if (new URL(url).pathname === '/przeglad/index.json') return Promise.resolve(Response.json(issues));
      if (new URL(url).pathname === '/teksty/posts.json') return Promise.resolve(Response.json(posts));
      return Promise.resolve(new Response('', { status: 404 }));
    } } },
  };
}
function applyRewrite(html, marker, handler) {
  let output = html;
  const element = {
    append: (value) => { output = output.replace(marker, `${value}${marker}`); },
    before: (value) => { output = output.replace(marker, `${value}${marker}`); },
    setInnerContent: (value) => { output = output.replace(`${marker}</div>`, `${marker}${value}</div>`); },
  };
  handler.element(element);
  return output;
}
class FakeRewriter {
  handlers = [];
  on(selector, handler) { this.handlers.push({ selector, handler }); return this; }
  async transform(response) {
    let html = await response.text();
    for (const { selector, handler } of this.handlers) {
      const marker = selector === 'head' ? '</head>' : selector === '.fastext' ? '<nav class="fastext">' : '<div id="text-list">';
      if (!html.includes(marker)) continue;
      html = applyRewrite(html, marker, handler);
    }
    return new Response(html);
  }
}

test('home links latest digest title and archive separately; Atom keeps issue entries', async () => {
  const originalFetch = globalThis.fetch;
  const originalRewriter = globalThis.HTMLRewriter;
  globalThis.fetch = () => Promise.resolve(Response.json({ version: 'https://jsonfeed.org/version/1.1', items: [] }));
  globalThis.HTMLRewriter = FakeRewriter;
  try {
    const homeHtml = await (await home(context())).text();
    const textsHtml = await (await texts(context('/teksty/'))).text();
    const xml = await (await feed(context('/teksty/feed.xml'))).text();
    for (const html of [homeHtml, textsHtml]) {
      assert.match(html, /href="\/przeglad\/"/);
      assert.match(html, /lang="en">Older text/);
      assert.match(html, /lang="pl">Token World Cup/);
      assert.match(html, /lang="en">Featured/);
      assert.doesNotMatch(html, /Invalid/);
    }
    assert.match(homeHtml, /<a class="textdigestcategory" href="\/przeglad\/">CoCzyDziennik<\/a>/);
    assert.match(homeHtml, /<a class="texttitlelink" href="\/przeglad\/2026-11-02\/">News &amp; &lt;more&gt;<\/a>/);
    assert.match(homeHtml, /<a class="textsheadinglink" href="\/teksty\/">P500 · TEKSTY<\/a>/);
    assert.doesNotMatch(homeHtml, /ARCHIWUM/);
    assert.doesNotMatch(textsHtml, /href="\/przeglad\/2026-11-02\/"/);
    assert.doesNotMatch(textsHtml, /News &amp; &lt;more&gt;/);
    assert.ok(homeHtml.includes('P600 · FEATURED'));
    assert.doesNotMatch(homeHtml, /<details class="textexpand">/);
    assert.ok(homeHtml.indexOf('CoCzyDziennik') < homeHtml.indexOf('<nav class="fastext">'));
    assert.match(textsHtml, /<div id="text-list">[\s\S]*Older text[\s\S]*<\/div>/);
    assert.ok(textsHtml.indexOf('CoCzyDziennik') < textsHtml.indexOf('Older text'));
    assert.ok(textsHtml.indexOf('Older text') < textsHtml.indexOf('Token World Cup'), 'featured is not pinned');
    assert.match(xml, /<id>https:\/\/travny\.pages\.dev\/przeglad\/2026-11-02\/<\/id>/);
    assert.match(xml, /<link rel="alternate" href="https:\/\/bartek\.lol\/przeglad\/2026-11-02\/"\/>/);
    assert.ok(xml.indexOf('News &amp; &lt;more&gt;') < xml.indexOf('Older text'));
    assert.match(xml, /<id>https:\/\/trfny\.com\/teksty\/old\/<\/id>/);
    assert.match(xml, /<entry xml:lang="pl">\s*<title>News &amp; &lt;more&gt;<\/title>\s*<id>https:\/\/travny\.pages\.dev\/przeglad\/2026-11-02\/<\/id>\s*<link rel="alternate" href="https:\/\/bartek\.lol\/przeglad\/2026-11-02\/"\/>\s*<updated>2026-11-03T09:00:00.000Z<\/updated>/);
    assert.doesNotMatch(xml, /Broken slug/);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.HTMLRewriter = originalRewriter;
  }
});

test('missing or broken digest index leaves existing publications available', async () => {
  for (const result of [new Response('', { status: 404 }), new Response('not json'), Response.json({})]) {
    const ctx = context();
    ctx.env.ASSETS.fetch = () => Promise.resolve(result);
    assert.deepEqual(await getDigestPosts(ctx), []);
  }
});

test('home shows only the latest digest and latest Shitpost even when articles dominate', async () => {
  const originalFetch = globalThis.fetch;
  const originalRewriter = globalThis.HTMLRewriter;
  const articles = Array.from({ length: 7 }, (_, index) => ({
    slug: `article-${index + 1}`,
    title: `Article ${index + 1}`,
    summary: 'A normal article',
    date: '2026-11-03',
    updated: new Date(Date.UTC(2026, 10, 3, 12, index)).toISOString(),
    kind: 'TEXT',
    tags: [],
  }));
  const reactor = Array.from({ length: 7 }, (_, index) => ({
    id: `https://shitpost.trfny.com/posts/gh-1-${index + 1}`,
    url: `https://shitpost-reactor.travny.workers.dev/posts/gh-1-${index + 1}`,
    summary: `Shit ${index + 1} <meme>`,
    language: 'zh-Hans-CN',
    title: `Policy topic ${index + 1}`,
    date_published: new Date(Date.UTC(2026, 10, 2, 12, index + 1)).toISOString(),
  }));
  reactor.push(...Array.from({ length: 10 }, (_, index) => ({
    url: `https://shitpost.bartek.lol/posts/gh-2-${index + 1}`,
    title: `Recently edited older Shitpost ${index + 1}`,
    date_published: '2026-11-02T10:00:00Z',
    date_modified: '2026-11-05T12:00:00Z',
  })));
  globalThis.fetch = () => Promise.resolve(Response.json({ items: reactor }));
  globalThis.HTMLRewriter = FakeRewriter;
  const ctx = context();
  const originalAssetsFetch = ctx.env.ASSETS.fetch;
  ctx.env.ASSETS.fetch = (url) => {
    if (!(url instanceof Request) && new URL(url).pathname === '/teksty/posts.json') {
      return Promise.resolve(Response.json(articles));
    }
    if (!(url instanceof Request) && new URL(url).pathname === '/przeglad/index.json') {
      return Promise.resolve(Response.json([{
        id: '2026-11-01',
        title: 'CoCzyDziennik edition',
        description: 'A digest',
        date: '2026-11-01T00:00:00.000Z',
      }, {
        id: '2026-10-31',
        title: 'Recently edited older digest',
        description: 'An older issue',
        date: '2026-10-31T00:00:00.000Z',
        updated: '2026-11-04T00:00:00.000Z',
      }]));
    }
    return originalAssetsFetch(url);
  };
  try {
    const html = await (await home(ctx)).text();
    const start = html.indexOf('<section class="texthome"');
    const end = html.indexOf('</section>', start);
    const listing = html.slice(start, end);
    const [initial, rest] = listing.split('<details class="textexpand">');
    assert.equal((initial.match(/class="textitem/gu) || []).length, 3);
    assert.equal((rest.match(/class="textitem/gu) || []).length, 6);
    assert.equal((listing.match(/class="textitem/gu) || []).length, 9);
    assert.match(rest, /<summary class="texttoggle">/);
    assert.match(rest, /POKAŻ KOLEJNE 6/);
    assert.match(rest, /▲ ZWIŃ/);
    assert.ok(initial.includes('Shit 7 &lt;meme&gt;'));
    assert.match(initial, /lang="zh-Hans-CN"><a[^>]*>Policy topic 7<\/a>/);
    assert.ok(initial.includes('lang="zh-Hans-CN">Shit 7 &lt;meme&gt;'));
    assert.doesNotMatch(listing, /SHITPOST REACTOR|· SHITPOST|SHITPOST OF THE DAY/);
    const titles = (section) => [...section.matchAll(/<h3[^>]*>(?:<a[^>]*>)?([^<]+)(?:<\/a>)?<\/h3>/gu)].map((match) => match[1]);
    assert.deepEqual(titles(initial), ['Article 7', 'Policy topic 7', 'CoCzyDziennik edition']);
    assert.deepEqual(titles(rest), ['Article 6', 'Article 5', 'Article 4', 'Article 3', 'Article 2', 'Article 1']);
    assert.equal(listing.split('href="/przeglad/"').length - 1, 1);
    assert.equal(listing.split('href="/przeglad/2026-11-01/"').length - 1, 1);
    assert.doesNotMatch(listing, /Recently edited older digest|ARCHIWUM/);
    assert.match(listing, /href="https:\/\/shitpost\.bartek\.lol\/posts\/gh-1-7"/);
    assert.doesNotMatch(listing, /href="https:\/\/shitpost\.bartek\.lol\/posts\/gh-1-6"/);
    assert.match(listing, /href="\/teksty\/">P500 · TEKSTY<\/a>/);
    const reactorHome = 'href="https://shitpost.bartek.lol/"';
    assert.equal(listing.split(reactorHome).length - 1, 1);
    assert.match(initial, /href="https:\/\/shitpost\.bartek\.lol\/">Reactor<\/a>/);
    const textsHtml = await (await texts(context('/teksty/'))).text();
    assert.ok(textsHtml.includes(reactorHome));
    assert.equal(textsHtml.split('href="/przeglad/"').length - 1, 1);
    assert.doesNotMatch(textsHtml, /href="\/przeglad\/2026-11-02\/"/);
    assert.ok(textsHtml.includes('REACTOR ↗'));
    assert.ok(!textsHtml.includes('href="https://shitpost.bartek.lol/posts/gh-1-7"'));
    const atom = await (await feed(context('/teksty/feed.xml'))).text();
    assert.ok(atom.includes('<link rel="alternate" href="https://shitpost.bartek.lol/posts/gh-1-7"/>'));
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.HTMLRewriter = originalRewriter;
  }
});
