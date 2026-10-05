import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const FORM_TTL_MS = 10 * 60 * 1000;
const MAX_OAUTH_BODY_BYTES = 32 * 1024;
const OAUTH_SCOPE = 'mcp';

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function normalizeConfiguredSecret(value) {
  if (typeof value !== 'string') return '';
  let normalized = value.trim();
  if (normalized.length >= 2) {
    const first = normalized[0];
    const last = normalized.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      normalized = normalized.slice(1, -1).trim();
    }
  }
  return normalized;
}

function normalizeSubmittedSecret(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function signedValue(prefix, payload, secret) {
  const body = base64urlJson(payload);
  const unsigned = `${prefix}.${body}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function verifiedValue(value, prefix, secret) {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== prefix) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', secret).update(unsigned).digest('base64url');
  if (!safeEqual(parts[2], expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function oauthJson(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

function oauthError(error, description, status = 400) {
  return oauthJson(
    description ? { error, error_description: description } : { error },
    status,
  );
}

async function limitedText(request) {
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_OAUTH_BODY_BYTES) throw new Error('oauth_payload_too_large');
  return text;
}

function parseScope(scope) {
  if (!scope) return [OAUTH_SCOPE];
  const scopes = scope.trim().split(/\s+/).filter(Boolean);
  return scopes.length ? scopes : [OAUTH_SCOPE];
}

function validateScope(scope) {
  const scopes = parseScope(scope);
  return scopes.length === 1 && scopes[0] === OAUTH_SCOPE;
}

function validRedirectUri(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    if (url.protocol !== 'http:') return false;
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

function htmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function loginPage(origin, nonce, error = '') {
  const errorHtml = error ? `<p role="alert">${htmlEscape(error)}</p>` : '';
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Authorize Claudiusz69</title>
<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:10vh auto;padding:1.5rem;line-height:1.5}input,button{font:inherit;padding:.7rem;width:100%;box-sizing:border-box}button{margin-top:1rem;cursor:pointer}code{overflow-wrap:anywhere}p[role=alert]{color:#b42318}</style>
</head>
<body>
<h1>Authorize Claudiusz69</h1>
<p>Enter the Claudiusz MCP access code to authorize this MCP client.</p>
${errorHtml}
<form method="post" action="${htmlEscape(origin)}/oauth/authorize" autocomplete="off">
<input type="hidden" name="form_nonce" value="${htmlEscape(nonce)}">
<label>Access code<br><input type="password" name="access_code" required autofocus autocomplete="current-password"></label>
<button type="submit">Authorize</button>
</form>
</body>
</html>`, {
    status: error ? 401 : 200,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function pkceChallenge(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

function issueToken(prefix, claims, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  return signedValue(prefix, { ...claims, iat: now, exp: now + ttlSeconds }, secret);
}

function validateTimedToken(value, prefix, secret, expected) {
  const claims = verifiedValue(value, prefix, secret);
  if (!claims) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) return null;
  if (claims.typ !== expected.typ || claims.aud !== expected.aud || claims.scope !== OAUTH_SCOPE) return null;
  return claims;
}

function tokenResponse(secret, clientId, resourceUrl) {
  const common = { sub: 'owner', aud: resourceUrl, scope: OAUTH_SCOPE, client_id: clientId };
  return oauthJson({
    access_token: issueToken('claudiusz_at', { ...common, typ: 'access' }, secret, ACCESS_TOKEN_TTL_SECONDS),
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: issueToken('claudiusz_rt', { ...common, typ: 'refresh' }, secret, REFRESH_TOKEN_TTL_SECONDS),
    scope: OAUTH_SCOPE,
  });
}

export function createManufactOAuthGateway({ secret }) {
  const configuredSecret = normalizeConfiguredSecret(secret);
  const authorizationCodes = new Map();
  const pendingForms = new Map();

  function prune() {
    const now = Date.now();
    for (const [key, value] of authorizationCodes) if (value.expiresAt <= now) authorizationCodes.delete(key);
    for (const [key, value] of pendingForms) if (value.expiresAt <= now) pendingForms.delete(key);
  }

  function resourceMetadata(origin) {
    return oauthJson({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      scopes_supported: [OAUTH_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: 'Claudiusz69',
    });
  }

  function authorizationServerMetadata(origin) {
    return oauthJson({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      scopes_supported: [OAUTH_SCOPE],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
    });
  }

  async function register(request) {
    if (!configuredSecret) return oauthError('server_error', 'OAuth access code is not configured', 503);
    if (request.method !== 'POST') return oauthError('invalid_request', 'POST required', 405);
    let body;
    try {
      body = JSON.parse(await limitedText(request));
    } catch (error) {
      return oauthError('invalid_client_metadata', error instanceof Error ? error.message : 'Invalid JSON');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return oauthError('invalid_client_metadata');
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 10) {
      return oauthError('invalid_redirect_uri');
    }
    if (!redirectUris.every((uri) => typeof uri === 'string' && uri.length <= 2048 && validRedirectUri(uri))) {
      return oauthError('invalid_redirect_uri');
    }
    const uniqueRedirectUris = [...new Set(redirectUris)];
    const authMethod = body.token_endpoint_auth_method ?? 'none';
    if (authMethod !== 'none') return oauthError('invalid_client_metadata', 'Only public PKCE clients are supported');
    if (Array.isArray(body.grant_types) && body.grant_types.some((grant) => !['authorization_code', 'refresh_token'].includes(grant))) {
      return oauthError('invalid_client_metadata', 'Unsupported grant type');
    }
    if (Array.isArray(body.response_types) && body.response_types.some((type) => type !== 'code')) {
      return oauthError('invalid_client_metadata', 'Unsupported response type');
    }
    const issuedAt = Math.floor(Date.now() / 1000);
    const clientId = signedValue('claudiusz_client', { redirect_uris: uniqueRedirectUris, iat: issuedAt }, configuredSecret);
    return oauthJson({
      client_id: clientId,
      client_id_issued_at: issuedAt,
      redirect_uris: uniqueRedirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }, 201);
  }

  function validateAuthorizationParams(params, origin) {
    if (params.get('response_type') !== 'code') return { error: 'unsupported_response_type' };
    const clientId = params.get('client_id');
    const redirectUri = params.get('redirect_uri');
    const challenge = params.get('code_challenge');
    const challengeMethod = params.get('code_challenge_method');
    const resource = params.get('resource') ?? `${origin}/mcp`;
    if (!clientId || !redirectUri || !challenge) return { error: 'invalid_request' };
    if (challengeMethod !== 'S256') return { error: 'invalid_request' };
    if (!validateScope(params.get('scope'))) return { error: 'invalid_scope' };
    if (resource !== `${origin}/mcp`) return { error: 'invalid_target' };
    const client = verifiedValue(clientId, 'claudiusz_client', configuredSecret);
    if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri)) {
      return { error: 'invalid_client' };
    }
    return {
      clientId,
      redirectUri,
      challenge,
      resource,
      state: params.get('state'),
    };
  }

  async function authorize(request, origin) {
    if (!configuredSecret) return oauthError('server_error', 'OAuth access code is not configured', 503);
    prune();
    if (request.method === 'GET') {
      const validated = validateAuthorizationParams(new URL(request.url).searchParams, origin);
      if (validated.error) return oauthError(validated.error);
      const nonce = randomBytes(24).toString('base64url');
      pendingForms.set(nonce, { ...validated, expiresAt: Date.now() + FORM_TTL_MS });
      return loginPage(origin, nonce);
    }
    if (request.method !== 'POST') return oauthError('invalid_request', 'GET or POST required', 405);
    let values;
    try {
      values = new URLSearchParams(await limitedText(request));
    } catch (error) {
      return oauthError('invalid_request', error instanceof Error ? error.message : 'Invalid request');
    }
    const nonce = values.get('form_nonce') ?? '';
    const pending = pendingForms.get(nonce);
    if (!pending || pending.expiresAt <= Date.now()) {
      pendingForms.delete(nonce);
      return oauthError('invalid_request', 'Authorization form expired');
    }
    const accessCode = normalizeSubmittedSecret(values.get('access_code'));
    if (!safeEqual(accessCode, configuredSecret)) return loginPage(origin, nonce, 'Invalid access code');
    pendingForms.delete(nonce);
    const code = randomBytes(32).toString('base64url');
    authorizationCodes.set(code, {
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      challenge: pending.challenge,
      resource: pending.resource,
      expiresAt: Date.now() + AUTH_CODE_TTL_MS,
    });
    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set('code', code);
    if (pending.state) redirect.searchParams.set('state', pending.state);
    return new Response(null, {
      status: 302,
      headers: { 'Cache-Control': 'no-store', Location: redirect.toString() },
    });
  }

  async function token(request, origin) {
    if (!configuredSecret) return oauthError('server_error', 'OAuth access code is not configured', 503);
    if (request.method !== 'POST') return oauthError('invalid_request', 'POST required', 405);
    prune();
    let values;
    try {
      values = new URLSearchParams(await limitedText(request));
    } catch (error) {
      return oauthError('invalid_request', error instanceof Error ? error.message : 'Invalid request');
    }
    const grantType = values.get('grant_type');
    if (grantType === 'authorization_code') {
      const clientId = values.get('client_id') ?? '';
      const redirectUri = values.get('redirect_uri') ?? '';
      const code = values.get('code') ?? '';
      const verifier = values.get('code_verifier') ?? '';
      const resource = values.get('resource') ?? `${origin}/mcp`;
      const client = verifiedValue(clientId, 'claudiusz_client', configuredSecret);
      if (!client) return oauthError('invalid_client', undefined, 401);
      const pending = authorizationCodes.get(code);
      if (!pending || pending.expiresAt <= Date.now()) {
        authorizationCodes.delete(code);
        return oauthError('invalid_grant');
      }
      authorizationCodes.delete(code);
      if (
        pending.clientId !== clientId ||
        pending.redirectUri !== redirectUri ||
        pending.resource !== resource ||
        verifier.length < 43 ||
        verifier.length > 128 ||
        !safeEqual(pkceChallenge(verifier), pending.challenge)
      ) {
        return oauthError('invalid_grant');
      }
      return tokenResponse(configuredSecret, clientId, `${origin}/mcp`);
    }
    if (grantType === 'refresh_token') {
      const clientId = values.get('client_id') ?? '';
      const refreshToken = values.get('refresh_token') ?? '';
      const client = verifiedValue(clientId, 'claudiusz_client', configuredSecret);
      if (!client) return oauthError('invalid_client', undefined, 401);
      const claims = validateTimedToken(refreshToken, 'claudiusz_rt', configuredSecret, {
        typ: 'refresh',
        aud: `${origin}/mcp`,
      });
      if (!claims || claims.client_id !== clientId) return oauthError('invalid_grant');
      return tokenResponse(configuredSecret, clientId, `${origin}/mcp`);
    }
    return oauthError('unsupported_grant_type');
  }

  function challenge(origin) {
    return oauthJson({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401, {
      'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="${OAUTH_SCOPE}"`,
    });
  }

  function withWorkerSecret(request) {
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${secret}`);
    return new Request(request, { headers });
  }

  function authorizeMcp(request, origin) {
    if (!configuredSecret) return challenge(origin);
    const header = request.headers.get('authorization') ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    const presented = match?.[1] ?? '';
    if (
      presented &&
      (safeEqual(presented, secret ?? '') ||
        safeEqual(normalizeSubmittedSecret(presented), configuredSecret))
    ) {
      return safeEqual(presented, secret ?? '') ? request : withWorkerSecret(request);
    }
    if (presented) {
      const claims = validateTimedToken(presented, 'claudiusz_at', configuredSecret, {
        typ: 'access',
        aud: `${origin}/mcp`,
      });
      if (claims) return withWorkerSecret(request);
    }
    return challenge(origin);
  }

  return async function oauthGateway(request) {
    const url = new URL(request.url);
    const origin = url.origin;
    if (
      url.pathname === '/.well-known/oauth-protected-resource' ||
      url.pathname === '/.well-known/oauth-protected-resource/mcp'
    ) {
      return resourceMetadata(origin);
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return authorizationServerMetadata(origin);
    }
    if (url.pathname === '/oauth/register') return register(request);
    if (url.pathname === '/oauth/authorize') return authorize(request, origin);
    if (url.pathname === '/oauth/token') return token(request, origin);
    if (url.pathname === '/mcp' && request.method !== 'OPTIONS') return authorizeMcp(request, origin);
    return request;
  };
}
