import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { ensureIndexed } from '../worker.mjs';

function post(n, publishedAt = new Date(Date.UTC(2026, 0, n)).toISOString()) {
  const id = `gh-${1000 + n}-1`;
  return {
    id, published_at: publishedAt, generated_at: publishedAt,
    url: `https://shitpost.trfny.com/posts/${id}`,
    provider: 'test', model: 'test',
    schema_version: 2, content: { kind: 'text', text: `Post number ${n}` },
  };
}

function bucket(posts, { legacy = false, legacyCount = posts.length } = {}) {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const sorted = [...posts].sort((a, b) => b.published_at.localeCompare(a.published_at));
  const entries = sorted.map((p) => ({ id: p.id, published_at: p.published_at }));
  let index = legacy ? entries.slice(0, legacyCount) : { version: 2, entries };
  let lists = 0;
  let bodies = 0;
  let puts = 0;
  const feed = {
    async get(key) {
      if (key === 'index.json') return { json: async () => structuredClone(index) };
      const p = byId.get(/^posts\/(gh-\d+-\d+)\.json$/u.exec(key)?.[1]);
      if (p) { bodies += 1; return { json: async () => p }; }
      return null;
    },
    async put(key, value) {
      assert.equal(key, 'index.json');
      puts++;
      index = JSON.parse(value);
    },
    async list({ prefix, cursor, include }) {
      assert.equal(prefix, 'posts/');
      assert.deepEqual(include, ['customMetadata']);
      lists++;
      const start = cursor ? Number(cursor) : 0;
      const ordered = [...posts].sort((a, b) => a.id.localeCompare(b.id));
      const page = ordered.slice(start, start + 35);
      return {
        objects: page.map((p) => ({
          key: `posts/${p.id}.json`, uploaded: new Date(p.published_at),
          customMetadata: { published_at: p.published_at },
        })),
        truncated: start + page.length < ordered.length,
        cursor: start + page.length < ordered.length ? String(start + page.length) : undefined,
      };
    },
  };
  return {
    env: { FEED: feed }, byId,
    add(p) {
      byId.set(p.id, p);
      posts.push(p);
      if (index?.version === 2) index.entries.unshift({ id: p.id, published_at: p.published_at });
    },
    get counts() { return { lists, bodies, puts }; },
    get manifest() { return index; },
  };
}

async function archive(env, cursor) {
  const url = `https://shitpost.trfny.com/archive${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
  const response = await worker.fetch(new Request(url), env);
  return { status: response.status, body: await response.text() };
}

test('newest first, 25 posts a page, without listing R2 on complete indexes', async () => {
  const b = bucket(Array.from({ length: 64 }, (_, i) => post(i + 1)));
  const first = await archive(b.env);
  assert.equal(first.status, 200);
  assert.equal((first.body.match(/<article>/g) || []).length, 25);
  assert.ok(first.body.indexOf('Post number 64') < first.body.indexOf('Post number 40'));
  assert.doesNotMatch(first.body, /Post number 39/);
  assert.match(first.body, /Newest first/);
  assert.match(first.body, /Older 25/);
  assert.doesNotMatch(first.body, /← Newer 25/);
  assert.deepEqual(b.counts, { lists: 0, bodies: 25, puts: 0 });
  const cursor = /\/archive\?cursor=(gh-\d+-\d+)/.exec(first.body)?.[1];
  assert.equal(cursor, post(40).id);
  const second = await archive(b.env, cursor);
  assert.equal((second.body.match(/<article>/g) || []).length, 25);
  assert.ok(second.body.indexOf('Post number 39') < second.body.indexOf('Post number 15'));
  assert.match(second.body, /← Newer 25/);
  assert.match(second.body, /Older 25/);
  const last = await archive(b.env, post(15).id);
  assert.equal((last.body.match(/<article>/g) || []).length, 14);
  assert.doesNotMatch(last.body, /Older 25/);
  assert.equal(b.counts.lists, 0);
});

test('stable post-ID cursor never skips or repeats items after a new publish', async () => {
  const b = bucket(Array.from({ length: 48 }, (_, i) => post(i + 1)));
  const before = await archive(b.env, post(24).id);
  const latest = post(49);
  b.add(latest);
  const after = await archive(b.env, post(24).id);
  const postIds = (html) => [...html.matchAll(/<article><h2><a href="\/posts\/(gh-\d+-\d+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(postIds(after.body), postIds(before.body));
  const first = await archive(b.env);
  assert.match(first.body, /Post number 49/);
});

test('deep archive navigation returns a newer page and a first-page link', async () => {
  const b = bucket(Array.from({ length: 75 }, (_, i) => post(i + 1)));
  const current = await archive(b.env, post(25).id);
  assert.match(current.body, /href="\/archive\?cursor=gh-1050-1">← Newer 25<\/a>/);
  assert.match(current.body, /href="\/archive">Newest<\/a>/);
});

test('bad, unknown, and previous opaque R2 cursors fail rather than reset silently', async () => {
  const b = bucket([post(1), post(2)]);
  for (const cursor of ['not-a-post', 'gh-99999-1', 'not%20valid']) {
    const result = await archive(b.env, cursor);
    assert.equal(result.status, 400, cursor);
  }
  assert.equal(b.counts.bodies, 0);
});

test('legacy index migrates old posts beyond the 250-entry cutoff without dropping history', async () => {
  const originals = Array.from({ length: 270 }, (_, i) => post(i + 1));
  const b = bucket(originals, { legacy: true, legacyCount: 250 });
  const old = await archive(b.env, post(25).id);
  assert.match(old.body, /Post number 24/);
  assert.match(old.body, /Post number 1/);
  assert.ok(b.counts.lists > 1);
  assert.equal(b.counts.puts, 0, 'GET must not persist index migration');

  await ensureIndexed(b.env, post(271));
  assert.equal(b.manifest.version, 2);
  assert.equal(b.manifest.entries.length, 271);
  assert.equal(b.counts.puts, 1);
  const scanned = b.counts.lists;
  await archive(b.env, post(26).id);
  assert.equal(b.counts.lists, scanned, 'completed index needs no more bucket scans');
});

test('feeds and homepage keep their bounded read sizes with a complete archive', async () => {
  const b = bucket(Array.from({ length: 310 }, (_, i) => post(i + 1)));
  const feed = await worker.fetch(new Request('https://shitpost.trfny.com/feed.json'), b.env);
  assert.equal(feed.status, 200);
  assert.equal(JSON.parse(await feed.text()).items.length, 50);
  assert.equal(b.counts.bodies, 50);
  assert.equal(b.counts.lists, 0);
});

test('timestamp ordering takes precedence over nonchronological run IDs', async () => {
  const first = post(1, '2026-03-01T01:00:00.000Z');
  const second = post(2, '2026-02-01T01:00:00.000Z');
  const b = bucket([second, first]);
  const result = await archive(b.env);
  assert.ok(result.body.indexOf('Post number 1') < result.body.indexOf('Post number 2'));
});
