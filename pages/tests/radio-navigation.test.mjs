import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dist = new URL('../astro/dist/', import.meta.url);

test('hub radio routes share one audio element, player script and persistence key', async () => {
  const paths = ['index.html', 'lab/index.html', 'lab/field-notes/index.html', 'lab/privacy/index.html', 'teksty/index.html', 'przeglad/index.html'];
  const pages = await Promise.all(paths.map(path => readFile(new URL(path, dist), 'utf8')));
  const player = /<section id="radio"[\s\S]*?<\/section>/;
  const script = /<script type="module" src="\/_astro\/RadioRouter\.[^"]+\.js">/g;
  assert.match(pages[0], player);
  for (const [index, html] of pages.entries()) {
    assert.match(html, /<meta name="astro-view-transitions-enabled" content="true">/);
    assert.equal(html.match(script)?.length, 1, paths[index]);
    assert.equal(html.match(/data-astro-transition-persist="hub-radio"/g)?.length, 1, paths[index]);
    assert.equal(html.match(player)?.[0], pages[0].match(player)?.[0], paths[index]);
  }
});

test('legacy hub routes keep the route announcer and radio styles in the head', async () => {
  for (const path of ['index.html', 'teksty/index.html']) {
    const html = await readFile(new URL(path, dist), 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    const assets = [...head.matchAll(/<link[^>]+href="\/(_astro\/[^"]+\.css)"/g)];
    const styles = await Promise.all(assets.map(([, asset]) => readFile(new URL(asset, dist), 'utf8')));
    const css = [head, ...styles].join('\n');
    assert.match(css, /\.astro-route-announcer\s*\{[^}]*position:\s*absolute/, path);
    assert.match(css, /\.radio-controls[\s\S]*?\{/, path);
  }
});
