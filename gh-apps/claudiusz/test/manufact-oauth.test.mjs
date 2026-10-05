import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createManufactOAuthGateway } from '../scripts/manufact-oauth.mjs';

const ORIGIN = 'https://claudiusz.example';
const SECRET = 'test-secret-abcdefghijklmnopqrstuvwxyz-123456';
const REDIRECT = 'https://client.example/callback';

async function register(gateway) {
  const response = await gateway(new Request(`${ORIGIN}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
  }));
  assert.ok(response instanceof Response);
  assert.equal(response.status, 201);
  return response.json();
}

function challenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

async function authorize(gateway, clientId, verifier) {
  const url = new URL(`${ORIGIN}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', REDIRECT);
  url.searchParams.set('scope', 'mcp');
  url.searchParams.set('state', 'state-123');
  url.searchParams.set('resource', `${ORIGIN}/mcp`);
  url.searchParams.set('code_challenge', challenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');

  const page = await gateway(new Request(url));
  assert.ok(page instanceof Response);
  assert.equal(page.status, 200);
  const html = await page.text();
  const nonce = html.match(/name="form_nonce" value="([^"]+)"/)?.[1];
  assert.ok(nonce);

  const response = await gateway(new Request(`${ORIGIN}/oauth/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ form_nonce: nonce, access_code: SECRET }),
  }));
  assert.ok(response instanceof Response);
  assert.equal(response.status, 302);
  const redirect = new URL(response.headers.get('location'));
  assert.equal(redirect.origin + redirect.pathname, REDIRECT);
  assert.equal(redirect.searchParams.get('state'), 'state-123');
  assert.ok(redirect.searchParams.get('code'));
  return redirect.searchParams.get('code');
}

test('publishes OAuth discovery and challenges unauthenticated MCP requests', async () => {
  const gateway = createManufactOAuthGateway({ secret: SECRET });
  const metadata = await gateway(new Request(`${ORIGIN}/.well-known/oauth-protected-resource`));
  assert.ok(metadata instanceof Response);
  assert.deepEqual(await metadata.json(), {
    resource: `${ORIGIN}/mcp`,
    authorization_servers: [ORIGIN],
    scopes_supported: ['mcp'],
    bearer_methods_supported: ['header'],
    resource_name: 'Claudiusz69',
  });

  const unauthorized = await gateway(new Request(`${ORIGIN}/mcp`, { method: 'POST', body: '{}' }));
  assert.ok(unauthorized instanceof Response);
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get('www-authenticate') ?? '', /resource_metadata=.*oauth-protected-resource\/mcp/);
});

test('supports DCR, authorization-code PKCE, one-time codes and refresh tokens', async () => {
  const gateway = createManufactOAuthGateway({ secret: SECRET });
  const registration = await register(gateway);
  assert.equal(registration.token_endpoint_auth_method, 'none');
  assert.ok(registration.client_id);

  const verifier = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~';
  const code = await authorize(gateway, registration.client_id, verifier);
  const tokenRequest = () => new Request(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: registration.client_id,
      redirect_uri: REDIRECT,
      code,
      code_verifier: verifier,
      resource: `${ORIGIN}/mcp`,
    }),
  });
  const tokenResponse = await gateway(tokenRequest());
  assert.ok(tokenResponse instanceof Response);
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  assert.equal(tokens.token_type, 'Bearer');
  assert.ok(tokens.access_token);
  assert.ok(tokens.refresh_token);

  const replay = await gateway(tokenRequest());
  assert.ok(replay instanceof Response);
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, 'invalid_grant');

  const authorized = await gateway(new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokens.access_token}` },
    body: '{}',
  }));
  assert.ok(authorized instanceof Request);
  assert.equal(authorized.headers.get('authorization'), `Bearer ${SECRET}`);

  const refreshed = await gateway(new Request(`${ORIGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: registration.client_id,
      refresh_token: tokens.refresh_token,
    }),
  }));
  assert.ok(refreshed instanceof Response);
  assert.equal(refreshed.status, 200);
  assert.ok((await refreshed.json()).access_token);
});

test('keeps the legacy bearer token working for CLI access', async () => {
  const gateway = createManufactOAuthGateway({ secret: SECRET });
  const request = new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${SECRET}` },
    body: '{}',
  });
  assert.equal(await gateway(request), request);
});
