'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { notify, hubUrls, digestUrls } = require('./indexnow.cjs');

test('digest-only publication selects the permalink and directories', () => {
  const paths = ['pages/astro/src/content/digests/2026-11-18.md'];
  assert.deepEqual(hubUrls(paths, '').sort(), digestUrls('2026-11-18').sort());
  assert.deepEqual(hubUrls(['README.md', 'pages/tests/example.mjs'], ''), []);
});

test('shared site changes select static canonical routes', () => {
  assert.deepEqual(hubUrls(['pages/site/assets/app.js'], '<loc>https://travny.pages.dev/</loc>'), ['https://travny.pages.dev/']);
});

test('submit scoped URLs once; failures do not fail publishing', async () => {
  let count = 0;
  const options = {
    log() {}, warn() {},
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://api.indexnow.org/indexnow');
      assert.equal(init.redirect, 'error');
      const payload = JSON.parse(init.body);
      assert.equal(payload.host, 'trvny.github.io');
      assert.deepEqual(payload.urlList, ['https://trvny.github.io/feedseek/']);
      assert.match(payload.keyLocation, /^https:\/\/trvny\.github\.io\/feedseek\//);
      count++;
      return { status: 202 };
    },
  };
  const root = 'https://trvny.github.io/feedseek/';
  assert.equal(await notify('feedseek', [root, root], options), true);
  assert.equal(await notify('feedseek', ['https://trvny.github.io/other/'], options), false);
  assert.equal(count, 1);
  assert.equal(await notify('hub', undefined, { ...options, fetchImpl: async () => ({ status: 429 }) }), false);
});
