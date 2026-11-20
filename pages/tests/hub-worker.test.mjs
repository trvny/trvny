import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { onRequestGet as now } from '../functions/api/radio-now.js';
import { onRequestGet as station } from '../functions/api/radio-station.js';

test('Pages forwards the original request and response via the private binding', async () => {
  for (const [handler, path] of [[now, '/api/radio-now'], [station, '/api/radio-station?station=bbc1']]) {
    const request = new Request('https://bartek.lol' + path);
    const response = new Response('bound', { status: 502, headers: { 'cache-control': 'no-store' } });
    let received;
    const env = { HUB_BACKEND: { fetch: incoming => {
      received = incoming;
      return response;
    } } };
    assert.equal(await handler({ request, env }), response);
    assert.equal(received, request);
  }
});

test('binding transport failure falls back to the shared local implementation', async t => {
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(Response.json({ title: 'Song', artist: 'Artist' })));
  const response = await now({
    request: new Request('https://bartek.lol/api/radio-now'),
    env: { HUB_BACKEND: { fetch: () => Promise.reject(new Error('binding unavailable')) } },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).title, 'Song');
});

test('Worker dispatches only known GET routes and preserves query parameters', async t => {
  const request = (path, method = 'GET') => new Request('https://bartek.lol' + path, { method });
  const fetchMock = t.mock.method(globalThis, 'fetch', () => Promise.resolve(Response.json({ title: 'Song', artist: 'Artist' })));
  assert.equal((await worker.fetch(request('/assets/radio.js'))).status, 404);
  assert.equal((await worker.fetch(request('/api/radio-now', 'POST'))).status, 405);
  const invalid = await worker.fetch(request('/API/radio-station/?station=bad'));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('x-travny-backend'), 'worker');
  assert.equal(fetchMock.mock.callCount(), 0);
  const result = await worker.fetch(request('/api/radio-now/'));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('x-travny-backend'), 'worker');
  assert.equal(result.headers.get('access-control-allow-origin'), 'https://tg-assistant.travny.workers.dev');
});

test('badge routes retain query customization and distinguish missing routes from unknown badges', async () => {
  const { onRequestGet: badge } = await import('../functions/badge/[[path]].js');
  const request = new Request('https://bartek.lol/badge/twojstar.svg?label=Custom');
  const params = { path: ['twojstar.svg'] };
  const old = { HUB_BACKEND: { fetch: () => new Response('Not found', { status: 404 }) } };
  const fallback = await badge({ request, params, env: old });
  assert.match(await fallback.text(), />Custom<\/text>/);
  const response = await badge({ request, params, env: { HUB_BACKEND: worker } });
  assert.equal(response.headers.get('x-travny-backend'), 'worker');
  assert.match(await response.text(), />Custom<\/text>/);
  const unknown = await worker.fetch(new Request('https://bartek.lol/badge/unknown.svg'));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get('x-travny-backend'), 'worker');
  assert.match(await unknown.text(), /unknown badge/);
  const index = await worker.fetch(new Request('https://bartek.lol/badge/index.json'));
  assert.equal(index.status, 200);
  assert.ok((await index.json()).badges.length > 0);
});

test('Worker HEAD preserves GET status and headers without a response body', async () => {
  for (const path of ['/badge/twojstar.svg?label=Custom', '/api/radio-station?station=invalid']) {
    const url = 'https://bartek.lol' + path;
    const get = await worker.fetch(new Request(url));
    const head = await worker.fetch(new Request(url, { method: 'HEAD' }));
    assert.equal(head.status, get.status);
    assert.deepEqual([...head.headers], [...get.headers]);
    assert.equal(await head.text(), '');
  }
});

test('public Pages HEAD routes preserve status and headers with old, missing or current bindings', async t => {
  t.mock.method(globalThis, 'fetch', () => Promise.resolve(Response.json({ title: 'Song', artist: 'Artist' })));
  const routes = [
    [await import('../functions/api/radio-now.js'), '/api/radio-now', {}],
    [await import('../functions/api/radio-station.js'), '/api/radio-station?station=invalid', {}],
    [await import('../functions/badge/[[path]].js'), '/badge/twojstar.svg', { path: ['twojstar.svg'] }],
  ];
  const old = { fetch(request) {
    if (new URL(request.url).pathname.startsWith('/badge/')) return new Response('Not found', { status: 404 });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
    return worker.fetch(request);
  } };
  for (const [route, path, params] of routes) {
    for (const env of [{}, { HUB_BACKEND: old }, { HUB_BACKEND: worker }]) {
      const url = 'https://bartek.lol' + path;
      const get = await route.onRequestGet({ request: new Request(url), params, env });
      const head = await route.onRequestHead({ request: new Request(url, { method: 'HEAD' }), params, env });
      assert.equal(head.status, get.status);
      assert.deepEqual([...head.headers], [...get.headers]);
      assert.equal(await head.text(), '');
    }
  }
});
