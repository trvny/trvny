import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RADIO_PAGES } from '../../scripts/build-static-shell.mjs';

test('Pages build publishes the shared router and one radio player on legacy routes', async () => {
  const site = new URL('../../site/', import.meta.url);
  const home = await readFile(new URL('index.html', site), 'utf8');
  const player = /<section id="radio"[\s\S]*?<\/section>/;
  const router = /<script type="module" src="\/_astro\/RadioRouter\.[^"]+\.js">/g;
  for (const path of RADIO_PAGES) {
    const html = await readFile(new URL(path, site), 'utf8');
    assert.equal(html.match(/<meta name="astro-view-transitions-enabled"/g)?.length, 1, path);
    assert.equal(html.match(/data-astro-transition-persist="hub-radio"/g)?.length, 1, path);
    assert.deepEqual(html.match(router), home.match(router), path);
    assert.equal(html.match(player)?.[0], home.match(player)?.[0], path);
  }
});
