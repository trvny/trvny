import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Script } from 'node:vm';

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

test('infrastructure map reads the public snapshot and keeps a typed, keyboard-accessible list', async () => {
  const html = await readFile(new URL('universe.html', root), 'utf8');
  const marker = "<script>";
  const start = html.indexOf(marker);
  const end = html.indexOf("</script>", start);
  assert.ok(start >= 0 && end > start);
  const source = html.slice(start + marker.length, end);
  assert.doesNotThrow(() => new Script(source));
  assert.match(source, /fetch\("\.\/infrastructure\.json",/);
  assert.match(html, /<summary>Browse nodes/);
  assert.match(source, /const relationLabels=/);
});
