import {
  AuthorizationError,
  OAuthError,
  OAuthProvider,
  type AuthRequest,
  type OAuthHelpers,
} from '@cloudflare/workers-oauth-provider';
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import { handleGremlinMcp, type RuntimeEnv } from 'kanarek-companion/runtime';
import worker from './index.ts';
import { GREMLIN_GITHUB_LOGIN, isGremlinGithubOwner } from './operator-identity.ts';
import { unauthenticatedMcpFallback } from './mcp-fallback.ts';
import { sealRefreshReceipt, openRefreshReceipt, type EncryptedRefreshReceipt } from './refresh-crypto.ts';

const ORIGIN = 'https://gremlin.travny.workers.dev';
const RESOURCE = `${ORIGIN}/mcp`;
const CALLBACK = `${ORIGIN}/oauth/github/callback`;
const OWNER_LOGIN = GREMLIN_GITHUB_LOGIN;

class GithubServiceUnavailable extends Error {}

interface GithubToken {
  access_token?: string;
  refresh_token?: string;
  error?: string;
}

export interface GremlinOAuthEnv extends RuntimeEnv {
  OAUTH_KV: KVNamespace;
  GREMLIN_OAUTH_REFRESH: DurableObjectNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  GREMLIN_OAUTH_CLIENT_ID?: string;
  GREMLIN_OAUTH_CLIENT_SECRET?: string;
}

interface OperatorProps {
  userId: string;
  githubToken: string;
  githubRefreshToken?: string;
}

const escapeHtml = (input: string): string =>
  input.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function unavailable(env: GremlinOAuthEnv): boolean {
  return !env.GREMLIN_OAUTH_CLIENT_ID?.trim() || !env.GREMLIN_OAUTH_CLIENT_SECRET?.trim();
}

function githubAuthorizeUrl(env: GremlinOAuthEnv, state: string, challenge: string): string {
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', env.GREMLIN_OAUTH_CLIENT_ID!);
  // GitHub Apps only accept offline_access as a scope; this enables rotatable user tokens.
  url.searchParams.set('scope', 'offline_access');
  url.searchParams.set('redirect_uri', CALLBACK);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function githubToken(env: GremlinOAuthEnv, input: Record<string, string>): Promise<GithubToken> {
  let response: Response;
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GREMLIN_OAUTH_CLIENT_ID!,
        client_secret: env.GREMLIN_OAUTH_CLIENT_SECRET!,
        ...input,
      }),
    });
  } catch {
    throw new GithubServiceUnavailable('GitHub token exchange is unavailable');
  }
  if (response.status === 403 || response.status === 429 || response.status >= 500) {
    throw new GithubServiceUnavailable('GitHub token exchange is unavailable');
  }
  if (!response.ok) return { error: 'invalid_grant' };
  return (await response.json()) as GithubToken;
}

async function ownerForToken(token: string): Promise<boolean> {
  let response: Response;
  try {
    response = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'MechaGremlin-OAuth',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch {
    throw new GithubServiceUnavailable('GitHub identity lookup is unavailable');
  }
  if (response.status === 429 || response.status === 403 || response.status >= 500) {
    throw new GithubServiceUnavailable('GitHub identity lookup is unavailable');
  }
  if (!response.ok) return false;
  const user: unknown = await response.json();
  return isGremlinGithubOwner(user);
}

async function sha256Url(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const binary = String.fromCharCode(...new Uint8Array(digest));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function authErrorRedirect(request: AuthRequest, error: string): string {
  const url = new URL(request.redirectUri);
  url.searchParams.set('error', error);
  if (request.state) url.searchParams.set('state', request.state);
  if (request.issuer) url.searchParams.set('iss', request.issuer);
  return url.toString();
}

async function startGithub(env: GremlinOAuthEnv, approved: {
  request: AuthRequest;
  headers: Headers;
}): Promise<Response> {
  const verifier = crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const upstream = await env.OAUTH_PROVIDER.beginUpstream(approved.request, {
    data: { verifier },
    headers: approved.headers,
  });
  upstream.headers.set('Location', githubAuthorizeUrl(env, upstream.state, await sha256Url(verifier)));
  return new Response(null, { status: 302, headers: upstream.headers });
}

function consentPage(name: string, clientDomain: string | undefined, redirectHost: string, loopback: boolean, scopes: string[], handle: string): string {
  const publisher = clientDomain
    ? `Published by <strong>${escapeHtml(clientDomain)}</strong>.`
    : 'Client identity is self-reported.';
  const scopeItems = scopes.map((scope) =>
    `<label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked> ${escapeHtml(scope)}</label>`).join('');
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize MechaGremlin</title>
<style>body{font-family:system-ui;max-width:36rem;margin:10vh auto;padding:1.5rem;line-height:1.6}button{font:inherit;padding:.5rem 1rem;margin-right:.5rem}label{display:block}</style>
<h1>Allow ${escapeHtml(name)} to use MechaGremlin?</h1>
<p>${publisher} Access will be sent to <strong>${escapeHtml(redirectHost)}</strong>.</p>
${loopback ? '<p><strong>Local app:</strong> continue only if you started this sign-in on your device.</p>' : ''}
<p>Access permits guarded GitHub and Cloudflare actions as the repository owner.</p>
<form method="post" action="/authorize"><input type="hidden" name="handle" value="${escapeHtml(handle)}">
${scopeItems}<p><button name="decision" value="approve">Allow</button><button name="decision" value="deny">Deny</button></p>
</form></html>`;
}

async function authorize(request: Request, env: GremlinOAuthEnv): Promise<Response> {
  if (unavailable(env)) return new Response('GitHub OAuth is not configured', { status: 503 });
  try {
    if (request.method === 'GET') {
      const parsed = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const details = await env.OAUTH_PROVIDER.describeConsent(parsed);
      const consent = await env.OAUTH_PROVIDER.beginConsent(parsed);
      consent.headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(consentPage(
        details.clientName,
        details.clientDomain,
        details.redirectHost,
        details.redirectIsLoopback,
        details.scope,
        consent.handle,
      ), { headers: consent.headers });
    }
    if (request.method === 'POST') {
      const form = await request.formData();
      const handle = String(form.get('handle') ?? '');
      if (form.get('decision') !== 'approve') {
        const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approvedScopes = form.getAll('scope').map(String);
      if (!approvedScopes.includes('mcp')) return new Response('Required scope missing', { status: 400 });
      const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, {
        scope: approvedScopes,
      });
      return startGithub(env, approved);
    }
    return new Response('Method not allowed', { status: 405 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      if (error.redirectTo) return Response.redirect(error.redirectTo, 302);
      return new Response('Invalid authorization request', { status: 400 });
    }
    throw error;
  }
}

async function githubCallback(request: Request, env: GremlinOAuthEnv): Promise<Response> {
  if (unavailable(env)) return new Response('GitHub OAuth is not configured', { status: 503 });
  try {
    const finished = await env.OAUTH_PROVIDER.finishUpstream<{ verifier: string }>(request);
    const url = new URL(request.url);
    if (url.searchParams.has('error')) {
      finished.headers.set('Location', authErrorRedirect(finished.request, 'access_denied'));
      return new Response(null, { status: 302, headers: finished.headers });
    }
    const code = url.searchParams.get('code');
    if (!code || !finished.data?.verifier) return new Response('Invalid GitHub callback', { status: 400 });
    const token = await githubToken(env, {
      code,
      redirect_uri: CALLBACK,
      code_verifier: finished.data.verifier,
    });
    if (!token.access_token || !token.refresh_token || !(await ownerForToken(token.access_token))) {
      finished.headers.set('Location', authErrorRedirect(finished.request, 'access_denied'));
      return new Response(null, { status: 302, headers: finished.headers });
    }
    const props: OperatorProps = {
      userId: OWNER_LOGIN,
      githubToken: token.access_token,
      ...(token.refresh_token ? { githubRefreshToken: token.refresh_token } : {}),
    };
    const grant = await env.OAUTH_PROVIDER.completeAuthorization({
      request: finished.request,
      userId: OWNER_LOGIN,
      metadata: { provider: 'github' },
      scope: finished.request.scope,
      props,
    });
    finished.headers.set('Location', grant.redirectTo);
    return new Response(null, { status: 302, headers: finished.headers });
  } catch (error) {
    if (error instanceof AuthorizationError) return new Response('Invalid or expired GitHub authorization', { status: 400 });
    if (error instanceof GithubServiceUnavailable) {
      return new Response('GitHub sign-in is temporarily unavailable; please retry', {
        status: 503,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' },
      });
    }
    throw error;
  }
}

// GitHub App refresh tokens rotate on use. Route each grant through one
// Durable Object so concurrent MCP refreshes share the same upstream exchange.
// Receipts are short-lived recovery data, not the canonical OAuth grant store.
const REFRESH_RECEIPT_MS = 3 * 60 * 1000;
type RefreshReceipt = EncryptedRefreshReceipt;

export class GremlinGithubRefreshCoordinator extends DurableObject<GremlinOAuthEnv> {
  private readonly pending = new Map<string, Promise<GithubToken>>();

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/refresh') {
      return new Response('Not found', { status: 404 });
    }
    let input: { refreshToken?: unknown };
    try {
      input = await request.json() as { refreshToken?: unknown };
    } catch {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    const refreshToken = input?.refreshToken;
    if (typeof refreshToken !== 'string' || refreshToken.length < 10 || refreshToken.length > 2048) {
      return Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    const hash = await sha256Url(refreshToken);
    let pending = this.pending.get(hash);
    if (!pending) {
      pending = this.exchange(hash, refreshToken);
      this.pending.set(hash, pending);
    }
    try {
      const token = await pending;
      return Response.json(token, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      if (error instanceof GithubServiceUnavailable) {
        return Response.json({ error: 'temporarily_unavailable' }, { status: 503 });
      }
      throw error;
    } finally {
      if (this.pending.get(hash) === pending) this.pending.delete(hash);
    }
  }

  private async exchange(hash: string, refreshToken: string): Promise<GithubToken> {
    const key = `rotation:${hash}`;
    const receipt = await this.ctx.storage.get<RefreshReceipt>(key);
    if (receipt && receipt.expiresAt > Date.now()) {
      return openRefreshReceipt<GithubToken>(receipt, this.env.GREMLIN_OAUTH_CLIENT_SECRET!, hash);
    }
    const value = await githubToken(this.env, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    if (value.access_token && value.refresh_token) {
      const sealed = await sealRefreshReceipt(value, this.env.GREMLIN_OAUTH_CLIENT_SECRET!, hash, Date.now() + REFRESH_RECEIPT_MS);
      await this.ctx.storage.put(key, sealed);
      await this.ctx.storage.setAlarm(Date.now() + REFRESH_RECEIPT_MS);
    }
    return value;
  }

  async alarm(): Promise<void> {
    const entries = await this.ctx.storage.list<RefreshReceipt>({ prefix: 'rotation:' });
    const now = Date.now();
    let next = Infinity;
    for (const [key, receipt] of entries) {
      if (receipt.expiresAt <= now) await this.ctx.storage.delete(key);
      else next = Math.min(next, receipt.expiresAt);
    }
    if (next !== Infinity) await this.ctx.storage.setAlarm(next);
  }
}

class GremlinMcpHandler extends WorkerEntrypoint<GremlinOAuthEnv, OperatorProps> {
  async fetch(request: Request): Promise<Response> {
    const context = this.ctx as typeof this.ctx & { auth?: { scope?: string[] } };
    if (!context.auth?.scope?.includes('mcp') ||
        this.ctx.props.userId !== OWNER_LOGIN || !this.ctx.props.githubToken) {
      return new Response('Forbidden', { status: 403 });
    }
    // The provider has already validated the MCP token. The shared adapter must
    // see the authorized GitHub user token for its existing operator policy check.
    // Never forward the MCP bearer to GitHub's /user endpoint.
    const authorizedHeaders = new Headers(request.headers);
    authorizedHeaders.set('Authorization', `Bearer ${this.ctx.props.githubToken}`);
    const authorizedRequest = new Request(request, { headers: authorizedHeaders });
    const response = await handleGremlinMcp(authorizedRequest, this.env, async (internalRequest) => {
      return worker.fetch!(internalRequest, this.env, this.ctx);
    });
    return response ?? new Response('Not found', { status: 404 });
  }
}

export function withGremlinOAuth(fallback: ExportedHandler<GremlinOAuthEnv>): ExportedHandler<GremlinOAuthEnv> {
  const defaultHandler: ExportedHandler<GremlinOAuthEnv> = {
    async fetch(request, env, ctx) {
      const pathname = new URL(request.url).pathname;
      if (pathname === '/authorize') return authorize(request, env);
      if (pathname === '/oauth/github/callback') return githubCallback(request, env);
      const failClosed = unauthenticatedMcpFallback(request, ORIGIN);
      if (failClosed) return failClosed;
      return fallback.fetch!(request, env, ctx);
    },
  };
  return new OAuthProvider<GremlinOAuthEnv>({
    apiRoute: '/mcp',
    apiHandler: GremlinMcpHandler,
    defaultHandler,
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: ['mcp', 'offline_access'],
    requiredScopes: ['mcp'],
    resourceMetadata: {
      resource: RESOURCE,
      authorization_servers: [ORIGIN],
      resource_name: 'MechaGremlin',
    },
    tokenExchangeCallback: async ({ grantType, props, env, grantId, userId }) => {
      if (grantType !== 'refresh_token') return;
      if (!props.githubRefreshToken) throw new OAuthError('invalid_grant', { description: 'Missing GitHub refresh credential; authorize again' });
      if (unavailable(env)) throw new OAuthError('temporarily_unavailable', { statusCode: 503, description: 'GitHub OAuth is unavailable' });
      let token: GithubToken;
      try {
        const id = env.GREMLIN_OAUTH_REFRESH.idFromName(`github-grant:${userId}:${grantId}`);
        const response = await env.GREMLIN_OAUTH_REFRESH.get(id).fetch('https://gremlin.internal/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: props.githubRefreshToken }),
        });
        if (!response.ok) throw new GithubServiceUnavailable('GitHub OAuth request failed');
        token = await response.json() as GithubToken;
      } catch {
        throw new OAuthError('temporarily_unavailable', { statusCode: 503, description: 'GitHub OAuth request failed' });
      }
      if (!token.access_token || !token.refresh_token) {
        throw new OAuthError(token.error === 'bad_refresh_token' ? 'invalid_grant' : 'temporarily_unavailable', { description: 'GitHub token refresh failed' });
      }
      return {
        newProps: {
          ...props,
          githubToken: token.access_token,
          githubRefreshToken: token.refresh_token,
        },
      };
    },
  });
}
