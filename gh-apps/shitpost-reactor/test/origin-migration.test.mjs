import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import worker, { renderAtom, renderJsonFeed, renderRss } from '../worker.mjs';

const stable = 'https://shitpost-reactor.travny.workers.dev';
const legacy = 'https://shitpost.trfny.com';
const post = {
  id: 'gh-123-1',
  generated_at: '2026-10-01T18:00:00.000Z',
  published_at: '2026-10-01T18:01:00.000Z',
  url: `${legacy}/posts/gh-123-1`,
  provider: 'openrouter', model: 'free-model',
  skill: { source: 'https://example.test/skill.zip', sha256: 'abc' },
  topic: null, schema_version: 2,
  content: { kind: 'text', text: 'A successful deployment. An unsuccessful application.' },
};

test('legacy feed identities survive while navigable URLs use the durable origin', () => {
  const rss = renderRss([post]);
  const atom = renderAtom([post]);
  const json = JSON.parse(renderJsonFeed([post]));
  assert.ok(rss.includes(`<guid isPermaLink="true">${post.url}</guid>`));
  assert.ok(rss.includes(`<link>${stable}/posts/${post.id}</link>`));
  assert.ok(atom.includes(`<id>${legacy}/</id>`));
  assert.ok(atom.includes(`<id>${post.url}</id>`));
  assert.ok(atom.includes(`<link href="${stable}/posts/${post.id}" rel="alternate"`));
  assert.ok(atom.includes(`<link href="${stable}/atom.xml" rel="self"`));
  assert.equal(json.items[0].id, post.url);
  assert.equal(json.items[0].url, `${stable}/posts/${post.id}`);
  assert.equal(json.home_page_url, `${stable}/`);
  assert.equal(json.feed_url, `${stable}/feed.json`);
  assert.equal(post.url, `${legacy}/posts/gh-123-1`);
});

test('old public URLs redirect in one hop without reading or rewriting R2', async () => {
  const env = { FEED: { get: () => { throw new Error('redirect must not touch R2'); } } };
  for (const method of ['GET', 'HEAD']) {
    for (const path of ['/', '/archive?cursor=gh-123-1', '/posts/gh-123-1', '/rss.xml', '/atom.xml', '/feed.json', '/sitemap.xml', '/robots.txt', '//example.com/path']) {
      for (const origin of [legacy, 'http://shitpost.trfny.com']) {
        const result = await worker.fetch(new Request(origin + path, { method }), env);
        assert.equal(result.status, 301);
        assert.equal(result.headers.get('location'), stable + path);
      }
    }
  }
});

test('reading a stored legacy post emits durable metadata without rewriting it', async () => {
  const result = await worker.fetch(new Request(`${stable}/posts/${post.id}`), {
    FEED: {
      get: async () => ({ json: async () => structuredClone(post) }),
      put: () => { throw new Error('public reads must not rewrite stored posts'); },
    },
  });
  const html = await result.text();
  assert.equal(result.status, 200);
  assert.ok(html.includes(`<link rel="canonical" href="${stable}/posts/${post.id}">`));
  assert.ok(html.includes(`"@id":"${stable}/posts/${post.id}#post"`));
  const legacyHost = new URL(legacy).host;
  const referencedUrls = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)]
    .map(([, value]) => {
      try {
        return new URL(value);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  assert.ok(referencedUrls.every((url) => url.host !== legacyHost));
  assert.equal(post.url, `${legacy}/posts/gh-123-1`);
});

function bucket(records = []) {
  const objects = new Map(records.map((record) => [`posts/${record.id}.json`, structuredClone(record)]));
  let postWrites = 0;
  return {
    objects,
    get postWrites() { return postWrites; },
    env: { FEED: {
      get: async (key) => key === 'index.json'
        ? { json: async () => [], etag: 'fixture-index', customMetadata: { archive_index_version: '2' } }
        : objects.has(key) ? { json: async () => structuredClone(objects.get(key)) } : null,
      put: async (key, body) => {
        if (key.startsWith('posts/')) { postWrites++; objects.set(key, JSON.parse(body)); }
      },
      list: async () => ({
        objects: [...objects].map(([key, record]) => ({ key, uploaded: new Date(record.published_at), customMetadata: { published_at: record.published_at } })),
        truncated: false,
      }),
    } },
  };
}

test('signed legacy-audience publishing works on both hosts; retries preserve old IDs', async (context) => {
  const issuer = 'https://token.actions.githubusercontent.com';
  const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const publicKey = { ...await crypto.subtle.exportKey('jwk', keyPair.publicKey), kid: 'migration-test' };
  context.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === `${issuer}/.well-known/openid-configuration`) {
      return Response.json({ issuer, jwks_uri: `${issuer}/.well-known/jwks` });
    }
    assert.equal(String(url), `${issuer}/.well-known/jwks`);
    return Response.json({ keys: [publicKey] });
  });
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  async function token(runId, aud = legacy) {
    const now = Math.floor(Date.now() / 1000);
    const input = `${encode({ alg: 'RS256', kid: 'migration-test' })}.${encode({
      iss: issuer, aud, repository: 'trvny/trvny', ref: 'refs/heads/main',
      workflow_ref: 'trvny/trvny/.github/workflows/shitpost-reactor.yml@refs/heads/main',
      event_name: 'workflow_dispatch', runner_environment: 'github-hosted',
      run_id: String(runId), run_attempt: '1', exp: now + 300, iat: now, nbf: now,
    })}`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(input));
    return `${input}.${Buffer.from(signature).toString('base64url')}`;
  }
  const publish = async (origin, jwt, store) => worker.fetch(new Request(`${origin}/api/publish`, {
    method: 'POST', headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(post),
  }), store.env);
  for (const origin of [legacy, stable]) {
    const store = bucket([post]);
    const result = await publish(origin, await token(123), store);
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), { ok: true, id: post.id, url: `${stable}/posts/${post.id}`, duplicate: true });
    assert.equal(store.postWrites, 0);
    assert.equal(store.objects.get(`posts/${post.id}.json`).url, post.url);
  }
  const fresh = bucket();
  const result = await publish(stable, await token(999), fresh);
  assert.equal(result.status, 201);
  assert.equal((await result.json()).url, `${stable}/posts/gh-999-1`);
  assert.equal(fresh.objects.get('posts/gh-999-1.json').url, `${stable}/posts/gh-999-1`);
  const rejected = await publish(stable, await token(1000, stable), fresh);
  assert.equal(rejected.status, 401);
  assert.equal(fresh.postWrites, 1);
});
