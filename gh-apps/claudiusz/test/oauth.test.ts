import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import test from 'node:test';

import worker, { type Env } from '../src/index.ts';
import { sign, verify } from '../src/oauth.ts';

const TOKEN = 'b'.repeat(32);
const ORIGIN = 'https://claudiusz-mcp.test';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const env: Env = { CLAUDIUSZ_APP_ID: '4454097', ALLOWED_OWNERS: 'trvny,travnie', CLAUDIUSZ_MCP_TOKEN: TOKEN };
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

const fetchWorker = (path: string, init?: RequestInit, e: Env = env) =>
  worker.fetch(new Request(`${ORIGIN}${path}`, init), e);

const form = (values: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(values).toString(),
});

async function registerClient(): Promise<string> {
  const response = await fetchWorker('/oauth/register', {
    method: 'POST',
    body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none' }),
  });
  assert.equal(response.status, 201);
  return ((await response.json()) as { client_id: string }).client_id;
}

async function authorizationCode(clientId: string, accessCode = TOKEN): Promise<Response> {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    scope: 'mcp',
    state: 'xyz',
  });
  const page = await fetchWorker(`/oauth/authorize?${params}`);
  assert.equal(page.status, 200);
  const nonce = (await page.text()).match(/name="form_nonce" value="([^"]+)"/)?.[1];
  assert.ok(nonce);
  return fetchWorker('/oauth/authorize', form({ form_nonce: nonce, access_code: accessCode }));
}

async function fullFlow() {
  const clientId = await registerClient();
  const redirect = await authorizationCode(clientId);
  assert.equal(redirect.status, 302);
  const location = new URL(redirect.headers.get('Location') ?? '');
  assert.equal(`${location.origin}${location.pathname}`, REDIRECT);
  assert.equal(location.searchParams.get('state'), 'xyz');
  const code = location.searchParams.get('code') ?? '';
  const tokens = await fetchWorker(
    '/oauth/token',
    form({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: REDIRECT, code, code_verifier: VERIFIER }),
  );
  assert.equal(tokens.status, 200);
  return { clientId, code, tokens: (await tokens.json()) as { access_token: string; refresh_token: string } };
}

const listTools = (bearer?: string, e: Env = env) =>
  fetchWorker(
    '/mcp',
    {
      method: 'POST',
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    },
    e,
  );

test('discovery metadata points at /mcp and this origin', async () => {
  const resource = (await (await fetchWorker('/.well-known/oauth-protected-resource/mcp')).json()) as any;
  assert.equal(resource.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(resource.authorization_servers, [ORIGIN]);
  const server = (await (await fetchWorker('/.well-known/oauth-authorization-server')).json()) as any;
  assert.equal(server.registration_endpoint, `${ORIGIN}/oauth/register`);
  assert.deepEqual(server.code_challenge_methods_supported, ['S256']);
});

test('/mcp without credentials returns a discovery challenge', async () => {
  const response = await listTools();
  assert.equal(response.status, 401);
  assert.match(
    response.headers.get('WWW-Authenticate') ?? '',
    /resource_metadata="https:\/\/claudiusz-mcp\.test\/\.well-known\/oauth-protected-resource\/mcp"/,
  );
});

test('full authorization code + PKCE flow yields a working access token', async () => {
  const { tokens } = await fullFlow();
  const response = await listTools(tokens.access_token);
  assert.equal(response.status, 200);
  const body = (await response.json()) as any;
  assert.ok(body.result.tools.some((tool: { name: string }) => tool.name === 'whoami'));
});

test('refresh token mints a new access token; access token cannot refresh', async () => {
  const { clientId, tokens } = await fullFlow();
  const refreshed = await fetchWorker(
    '/oauth/token',
    form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.refresh_token }),
  );
  assert.equal(refreshed.status, 200);
  assert.equal((await listTools(((await refreshed.json()) as any).access_token)).status, 200);
  const misuse = await fetchWorker(
    '/oauth/token',
    form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: tokens.access_token }),
  );
  assert.equal(misuse.status, 400);
});

test('wrong access code re-renders the form with 401', async () => {
  const response = await authorizationCode(await registerClient(), 'nope');
  assert.equal(response.status, 401);
  assert.match(await response.text(), /Invalid access code/);
});

test('code exchange rejects a wrong verifier, client or redirect', async () => {
  const clientId = await registerClient();
  const location = new URL((await authorizationCode(clientId)).headers.get('Location') ?? '');
  const code = location.searchParams.get('code') ?? '';
  const base = { grant_type: 'authorization_code', client_id: clientId, redirect_uri: REDIRECT, code };
  const wrongVerifier = await fetchWorker('/oauth/token', form({ ...base, code_verifier: 'w'.repeat(64) }));
  assert.equal(wrongVerifier.status, 400);
  const otherClient = await fetchWorker(
    '/oauth/token',
    form({ ...base, client_id: await registerClient(), code_verifier: VERIFIER }),
  );
  assert.equal(otherClient.status, 400);
  const otherRedirect = await fetchWorker(
    '/oauth/token',
    form({ ...base, redirect_uri: 'https://evil.test/cb', code_verifier: VERIFIER }),
  );
  assert.equal(otherRedirect.status, 400);
});

test('tokens signed with another secret, expired or tampered are refused', async () => {
  const claims = { sub: 'owner', aud: `${ORIGIN}/mcp`, scope: 'mcp', typ: 'access', client_id: 'c' };
  const future = Math.floor(Date.now() / 1000) + 600;
  assert.equal((await listTools(await sign('claudiusz_at', { ...claims, exp: future }, 'other'))).status, 401);
  assert.equal((await listTools(await sign('claudiusz_at', { ...claims, exp: 1 }, TOKEN))).status, 401);
  const good = await sign('claudiusz_at', { ...claims, exp: future }, TOKEN);
  assert.equal((await listTools(good)).status, 200);
  assert.equal((await listTools(`${good}x`)).status, 401);
  const otherAudience = await sign('claudiusz_at', { ...claims, aud: 'https://x.test/mcp', exp: future }, TOKEN);
  assert.equal((await listTools(otherAudience)).status, 401);
});

test('legacy tokenized path and raw Bearer secret still work', async () => {
  const legacy = await fetchWorker(`/${TOKEN}`, {
    method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert.equal(legacy.status, 200);
  assert.equal((await listTools(TOKEN)).status, 200);
});

test('OAuth endpoints and /mcp fail closed without a configured secret', async () => {
  const unset = { ...env, CLAUDIUSZ_MCP_TOKEN: undefined };
  const register = await fetchWorker(
    '/oauth/register',
    { method: 'POST', body: JSON.stringify({ redirect_uris: [REDIRECT] }) },
    unset,
  );
  assert.equal(register.status, 503);
  assert.equal((await listTools(await sign('claudiusz_at', {}, 'x'), unset)).status, 401);
});

test('signed values match the Manufact (node:crypto) format', async () => {
  const payload = { a: 1, b: 'two' };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const nodeSigned = `p.${body}.${createHmac('sha256', TOKEN).update(`p.${body}`).digest('base64url')}`;
  assert.equal(await sign('p', payload, TOKEN), nodeSigned);
  assert.deepEqual(await verify(nodeSigned, 'p', TOKEN), payload);
});
