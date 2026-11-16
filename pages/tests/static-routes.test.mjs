import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const routes = JSON.parse(await readFile(new URL('../site/_routes.json', import.meta.url), 'utf8'));
const matches = (pattern, path) => pattern.endsWith('/*')
  ? path.startsWith(pattern.slice(0, -1))
  : pattern === path;
const invokes = path => routes.include.some(pattern => matches(pattern, path))
  && !routes.exclude.some(pattern => matches(pattern, path));

test('static runtime files bypass Pages Functions', () => {
  for (const path of ["/assets/example.js","/_astro/example.js","/papagenerator/brainrot.js","/favicon.svg","/site.webmanifest","/teksty/githubowa-kraina/atlas.json","/teksty/githubowa-kraina/locales.json","/teksty/githubowa-kraina/explore.js","/teksty/posts.json","/przeglad/index.json"]) {
    assert.equal(invokes(path), false, path);
  }
});

test('HTML, discovery, redirects and dynamic endpoints retain middleware', () => {
  for (const path of [
    '/', '/index.html', '/tv', '/tv/', '/tv/index.html',
    '/lab/', '/lab/example/', '/przeglad/2026-11-16/',
    '/teksty/',
    '/teksty/grass-mud-horse-pl/', '/teksty/token-worldcup/token-worldcup.html',
    '/robots.txt', '/sitemap.xml', '/llms.txt', '/favicon.ico',
    '/badge/index.json', '/badge/status/hub.svg', '/badge/model/gpt-6.svg',
    '/weather', '/api/radio-now', '/api/radio-station',
    '/teksty/feed.xml', '/not-found',
  ]) {
    assert.equal(invokes(path), true, path);
  }
});

test('prerendered HTML aliases bypass Functions with existing redirects preserved', () => {
  for (const path of [
    '/papagenerator', '/papagenerator/', '/papagenerator/index', '/papagenerator/index.html',
    '/teksty/githubowa-kraina', '/teksty/githubowa-kraina/', '/teksty/githubowa-kraina/index', '/teksty/githubowa-kraina/index.html',
    '/teksty/githubowa-kraina/universe', '/teksty/githubowa-kraina/universe.html',
    '/teksty/token-worldcup', '/teksty/token-worldcup/', '/teksty/token-worldcup/index.html',
    '/teksty/token-worldcup/effort-matrix', '/teksty/token-worldcup/effort-matrix.html',
    '/badges', '/badges/', '/badges/index.html',
  ]) assert.equal(invokes(path), false, path);
});
