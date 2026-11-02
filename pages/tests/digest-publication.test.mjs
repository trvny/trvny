import test from 'node:test';
import assert from 'node:assert/strict';
import { getDigestPosts } from '../functions/_shared/digests.js';
import { onRequest as home } from '../functions/index.js';
import { onRequest as texts } from '../functions/teksty/index.js';
import { onRequestGet as feed } from '../functions/teksty/feed.xml.js';

const posts = [
  { slug: 'old', title: 'Older text', summary: 'Old summary', date: '2026-01', updated: '2026-01-01T00:00:00Z', kind: 'TEXT', tags: [] },
  { slug: 'token-worldcup', title: 'Token World Cup', summary: 'Featured', date: '2025-01', updated: '2025-01-01T00:00:00Z', kind: 'TEXT', tags: [], featured: true },
  { slug: '../broken', title: 'Broken slug', summary: 'Invalid URL', date: '2024-01', updated: '2024-01-01T00:00:00Z', kind: 'TEXT', tags: [] },
];
const issues = [
  { id: '2026-11-02', title: 'News & <more>', description: 'Latest issue', date: '2026-11-02T00:00:00.000Z', updated: '2026-11-03T09:00:00.000Z' },
  { id: '../bad', title: 'Invalid', description: 'Bad slug', date: '2026-11-02T00:00:00.000Z' },
];
function context(path = '/') {
  return {
    request: new Request(`https://travny.pages.dev${path}`),
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

test('published digest joins the home page, text directory and Atom while featured links stay pinned', async () => {
  const originalFetch = globalThis.fetch;
  const originalRewriter = globalThis.HTMLRewriter;
  globalThis.fetch = () => Promise.resolve(Response.json({ version: 'https://jsonfeed.org/version/1.1', items: [] }));
  globalThis.HTMLRewriter = FakeRewriter;
  try {
    const homeHtml = await (await home(context())).text();
    const textsHtml = await (await texts(context('/teksty/'))).text();
    const xml = await (await feed(context('/teksty/feed.xml'))).text();
    for (const html of [homeHtml, textsHtml]) {
      assert.match(html, /href="\/przeglad\/2026-11-02\/"/);
      assert.match(html, /News &amp; &lt;more&gt;/);
      assert.doesNotMatch(html, /Invalid/);
    }
    assert.ok(homeHtml.includes('P600 · FEATURED'));
    assert.ok(homeHtml.indexOf('News &amp; &lt;more&gt;') < homeHtml.indexOf('<nav class="fastext">'));
    assert.match(textsHtml, /<div id="text-list">[\s\S]*News &amp; &lt;more&gt;[\s\S]*<\/div>/);
    assert.ok(textsHtml.indexOf('Token World Cup') < textsHtml.indexOf('News &amp; &lt;more&gt;'));
    assert.ok(textsHtml.indexOf('News &amp; &lt;more&gt;') < textsHtml.indexOf('Older text'));
    assert.match(xml, /<id>https:\/\/travny\.pages\.dev\/przeglad\/2026-11-02\/<\/id>/);
    assert.match(xml, /<link rel="alternate" href="https:\/\/travny\.pages\.dev\/przeglad\/2026-11-02\/"\/>/);
    assert.ok(xml.indexOf('News &amp; &lt;more&gt;') < xml.indexOf('Older text'));
    assert.match(xml, /<id>https:\/\/trfny\.com\/teksty\/old\/<\/id>/);
    assert.match(xml, /<entry xml:lang="pl">\s*<title>News &amp; &lt;more&gt;<\/title>\s*<id>https:\/\/travny\.pages\.dev\/przeglad\/2026-11-02\/<\/id>\s*<link rel="alternate" href="https:\/\/travny\.pages\.dev\/przeglad\/2026-11-02\/"\/>\s*<updated>2026-11-03T09:00:00.000Z<\/updated>/);
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
