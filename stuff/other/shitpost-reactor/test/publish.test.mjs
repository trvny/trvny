import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishRecord, requestOidcToken } from '../publish.mjs';

test('requestOidcToken asks GitHub for the configured audience', async () => {
  const fakeFetch = (url, init) => {
    assert.equal(new URL(url).searchParams.get('audience'), 'https://shitpost.trfny.com');
    assert.equal(init.headers.authorization, 'Bearer runner-token');
    return new Response(JSON.stringify({ value: 'jwt-value' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const token = await requestOidcToken({
    requestUrl: 'https://oidc.example.test/token?x=1',
    requestToken: 'runner-token',
    fetchImpl: fakeFetch,
  });
  assert.equal(token, 'jwt-value');
});

test('publishRecord sends the draft with the OIDC bearer and returns the public URL', async () => {
  const fakeFetch = (_url, init) => {
    assert.equal(init.headers.authorization, 'Bearer jwt-value');
    assert.equal(JSON.parse(init.body).schema_version, 1);
    return new Response(JSON.stringify({ ok: true, url: 'https://shitpost.trfny.com/posts/gh-1-1' }), { status: 201, headers: { 'content-type': 'application/json' } });
  };
  const result = await publishRecord({ oidcToken: 'jwt-value', record: { schema_version: 1 }, fetchImpl: fakeFetch });
  assert.equal(result.url, 'https://shitpost.trfny.com/posts/gh-1-1');
});
