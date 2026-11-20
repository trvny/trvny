'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { notify, hubUrls } = require('./indexnow.cjs');

test('digest-only publication selects the permalink and directories', () => {
  const paths = ['pages/astro/src/content/digests/2026-11-18.md'];
  assert.deepEqual(hubUrls(paths, ''), [
    'https://travny.pages.dev/przeglad/',
    'https://travny.pages.dev/przeglad/2026-11-18/',
    'https://travny.pages.dev/teksty/',
  ]);
  assert.deepEqual(hubUrls(['README.md', 'pages/tests/example.mjs'], ''), []);
});

test('shared site changes select static canonical routes', () => {
  const home = '<loc>https://travny.pages.dev/</loc>';
  const removed = '<loc>https://travny.pages.dev/old/</loc>';
  assert.deepEqual(hubUrls(['pages/site/assets/app.js'], home, home + removed), [
    'https://travny.pages.dev/', 'https://travny.pages.dev/old/',
  ]);
  for (const path of ['pages/token-worldcup/token-worldcup.html', 'pages/scripts/worldcup-seo.mjs']) {
    assert.deepEqual(hubUrls([path], home), [
      'https://travny.pages.dev/teksty/token-worldcup/',
      'https://travny.pages.dev/teksty/token-worldcup/en/',
    ]);
  }
});

test('shared layouts include tracked digest routes and prefixed sitemap routes', () => {
  assert.deepEqual(hubUrls(['pages/astro/src/layouts/DigestLayout.astro'],
    '<s:loc>https://travny.pages.dev/</s:loc>', '',
    ['pages/astro/src/content/digests/2026-11-18.md', 'pages/astro/src/content/digests/README.md']), [
    'https://travny.pages.dev/',
    'https://travny.pages.dev/przeglad/',
    'https://travny.pages.dev/przeglad/2026-11-18/',
    'https://travny.pages.dev/teksty/',
  ]);
});

test('submit scoped URLs once; failures do not fail publishing', async () => {
  const requests = [];
  const options = {
    log() {}, warn() {},
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { status: 202 };
    },
  };
  const root = 'https://trvny.github.io/feedseek/';
  assert.equal(await notify('feedseek', [root, root], options), true);
  assert.equal(await notify('feedseek', ['https://trvny.github.io/other/'], options), false);
  assert.equal(await notify('feedseek', [root + 'guide%2Fintro'], options), false);
  assert.equal(requests.length, 1);
  const { url, init } = requests[0];
  assert.equal(url, 'https://api.indexnow.org/indexnow');
  assert.equal(init.redirect, 'error');
  const payload = JSON.parse(init.body);
  assert.equal(payload.host, 'trvny.github.io');
  assert.deepEqual(payload.urlList, [root]);
  assert.match(payload.keyLocation, /^https:\/\/trvny\.github\.io\/feedseek\//);
  assert.equal(await notify('hub', undefined, { ...options, fetchImpl: async () => ({ status: 429 }) }), false);
});
