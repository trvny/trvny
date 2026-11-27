import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildExplorerGraph, relationLabels } from '../site/assets/universe-data.js';

const root = new URL('../site/teksty/githubowa-kraina/', import.meta.url);

test('infrastructure snapshot has unique IDs and valid typed edges', async () => {
  const { snapshot, nodes, edges, clusters } = JSON.parse(await readFile(new URL('infrastructure.json', root), 'utf8'));
  assert.match(snapshot, /^\d{4}-\d{2}-\d{2}$/);
  const ids = new Set(nodes.map(node => node.id));
  assert.equal(ids.size, nodes.length);
  for (const { id, label, url, x, y } of nodes) {
    assert.match(id, /^[a-z0-9-]+$/);
    assert.ok(typeof label === "string" && label.trim());
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    if (url) assert.equal(new URL(url).protocol, 'https:');
  }
  for (const [from, to, kind] of edges) {
    assert.ok(ids.has(from) && ids.has(to));
    assert.notEqual(from, to);
    assert.match(kind, /^(source|service|storage|external)$/);
  }
  assert.ok(clusters.length);
});

test('explorer derives the complete map from the published infrastructure and atlas', async () => {
  const inputs = await Promise.all(['infrastructure.json', 'atlas.json'].map(async name =>
    JSON.parse(await readFile(new URL(name, root), 'utf8'))));
  const [snapshot, atlas] = inputs;
  const { nodes, edges } = buildExplorerGraph(snapshot, atlas);
  const byId = new Map(nodes.map(node => [node.id, node]));
  assert.equal(byId.size, nodes.length);
  assert.ok(nodes.length > snapshot.nodes.length);
  assert.ok(edges.length > snapshot.edges.length);
  for (const [from, to, kind] of edges) {
    assert.ok(byId.has(from) && byId.has(to) && relationLabels[kind]);
  }
  assert.ok(nodes.some(node => node.category === 'app' && node.label === 'Streambench'));
  assert.equal(byId.get('src-gptomek').category, 'agent');
  assert.ok(edges.some(([from, to, kind]) => from === 'pages' && to === 'domain-bartek-lol' && kind === 'host'));
});

test('infrastructure map keeps the diagram and directory alongside a lazy WebGL control', async () => {
  const html = await readFile(new URL('universe.html', root), 'utf8');
  assert.match(html, /<summary>Browse nodes/);
  assert.match(html, /id="graph"/);
  assert.match(html, /id="map-webgl" hidden/);
  assert.match(html, /src="\/assets\/universe-map.js"/);
  assert.doesNotMatch(html, /src="[^"]*universe-webgl/);
});
