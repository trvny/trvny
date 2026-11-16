import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { onRequestGet as now } from '../functions/api/radio-now.js';
import { onRequestGet as station } from '../functions/api/radio-station.js';

test('Pages forwards the original request and response via the private binding', async () => {
  for (const [handler, path] of [[now, '/api/radio-now'], [station, '/api/radio-station?station=bbc1']]) {
    const request = new Request('https://travny.pages.dev' + path);
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
    request: new Request('https://travny.pages.dev/api/radio-now'),
    env: { HUB_BACKEND: { fetch: () => Promise.reject(new Error('binding unavailable')) } },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).title, 'Song');
});

test('Worker dispatches only known GET routes and preserves query parameters', async t => {
  const request = (path, method = 'GET') => new Request('https://travny.pages.dev' + path, { method });
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
