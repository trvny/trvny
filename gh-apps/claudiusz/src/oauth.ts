// MCP OAuth for the Worker: discovery, dynamic client registration,
// Authorization Code + PKCE (S256), access and refresh tokens.
// Mirrors scripts/manufact-oauth.mjs (same prefixes, claims and HMAC key), so
// tokens from either runtime verify on both. Fully stateless: the authorize
// form nonce and the authorization code are signed values instead of in-memory
// maps, because consecutive requests may land on different isolates.
// Trade-off: a code is replayable until it expires (5 min); PKCE still binds
// it to the client that holds the verifier.

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_CODE_TTL_SECONDS = 5 * 60;
const FORM_TTL_SECONDS = 10 * 60;
const MAX_OAUTH_BODY_BYTES = 32 * 1024;
export const OAUTH_SCOPE = 'mcp';
export const MCP_PATH = '/mcp';

type Claims = Record<string, unknown>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function sign(prefix: string, payload: Claims, secret: string): Promise<string> {
  const unsigned = `${prefix}.${b64url(encoder.encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(unsigned));
  return `${unsigned}.${b64url(new Uint8Array(signature))}`;
}

export async function verify(value: unknown, prefix: string, secret: string): Promise<Claims | null> {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== prefix) return null;
  const signature = fromB64url(parts[2]);
  const body = fromB64url(parts[1]);
  if (!signature || !body) return null;
  const valid = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    signature,
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return null;
  try {
    const parsed = JSON.parse(decoder.decode(body));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Claims) : null;
  } catch {
    return null;
  }
}

const now = () => Math.floor(Date.now() / 1000);

async function verifyTimed(value: unknown, prefix: string, secret: string): Promise<Claims | null> {
  const claims = await verify(value, prefix, secret);
  return claims && typeof claims.exp === 'number' && claims.exp > now() ? claims : null;
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  // Hash first so lengths never leak and comparison work is fixed.
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const l = new Uint8Array(left);
  const r = new Uint8Array(right);
  let diff = 0;
  for (let i = 0; i < l.length; i += 1) diff |= l[i] ^ r[i];
  return diff === 0;
}

async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
}

function randomId(bytes = 16): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function oauthJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      ...extra,
    },
  });
}

function oauthError(error: string, description?: string, status = 400): Response {
  return oauthJson(description ? { error, error_description: description } : { error }, status);
}

async function limitedText(request: Request): Promise<string> {
  const text = await request.text();
  if (encoder.encode(text).byteLength > MAX_OAUTH_BODY_BYTES) throw new Error('oauth_payload_too_large');
  return text;
}

function validScope(scope: string | null): boolean {
  if (!scope) return true;
  const scopes = scope.trim().split(/\s+/).filter(Boolean);
  return scopes.length === 0 || (scopes.length === 1 && scopes[0] === OAUTH_SCOPE);
}

function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function loginPage(origin: string, nonce: string, error = ''): Response {
  const errorHtml = error ? `<p role="alert">${htmlEscape(error)}</p>` : '';
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Authorize Claudiusz69</title>
<style>body{font-family:system-ui,sans-serif;max-width:34rem;margin:10vh auto;padding:1.5rem;line-height:1.5}input,button{font:inherit;padding:.7rem;width:100%;box-sizing:border-box}button{margin-top:1rem;cursor:pointer}p[role=alert]{color:#b42318}</style>
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
</html>`,
    {
      status: error ? 401 : 200,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/html; charset=utf-8',
        // No form-action: Chromium applies it to the 302 after submit, which
        // leaves for the client's redirect_uri (another origin).
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}

async function tokenResponse(secret: string, clientId: string, resource: string): Promise<Response> {
  const common = { sub: 'owner', aud: resource, scope: OAUTH_SCOPE, client_id: clientId };
  const iat = now();
  return oauthJson({
    access_token: await sign(
      'claudiusz_at',
      { ...common, typ: 'access', iat, exp: iat + ACCESS_TOKEN_TTL_SECONDS },
      secret,
    ),
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: await sign(
      'claudiusz_rt',
      { ...common, typ: 'refresh', iat, exp: iat + REFRESH_TOKEN_TTL_SECONDS },
      secret,
    ),
    scope: OAUTH_SCOPE,
  });
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

export function challenge(origin: string): Response {
  return oauthJson({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }, 401, {
    'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl(origin)}", scope="${OAUTH_SCOPE}"`,
  });
}

/** True when the Bearer header carries a live access token minted for this resource. */
export async function validAccessToken(request: Request, secret: string | undefined, origin: string): Promise<boolean> {
  if (!secret) return false;
  const match = (request.headers.get('Authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const claims = await verifyTimed(match[1].trim(), 'claudiusz_at', secret);
  return Boolean(
    claims && claims.typ === 'access' && claims.aud === `${origin}${MCP_PATH}` && claims.scope === OAUTH_SCOPE,
  );
}

async function register(request: Request, secret: string): Promise<Response> {
  if (request.method !== 'POST') return oauthError('invalid_request', 'POST required', 405);
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await limitedText(request));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return oauthError('invalid_client_metadata');
    body = parsed;
  } catch (error) {
    return oauthError('invalid_client_metadata', error instanceof Error ? error.message : 'Invalid JSON');
  }
  const redirectUris = body.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length < 1 ||
    redirectUris.length > 10 ||
    !redirectUris.every((uri) => typeof uri === 'string' && uri.length <= 2048 && validRedirectUri(uri))
  ) {
    return oauthError('invalid_redirect_uri');
  }
  if ((body.token_endpoint_auth_method ?? 'none') !== 'none') {
    return oauthError('invalid_client_metadata', 'Only public PKCE clients are supported');
  }
  if (
    Array.isArray(body.grant_types) &&
    body.grant_types.some((grant) => grant !== 'authorization_code' && grant !== 'refresh_token')
  ) {
    return oauthError('invalid_client_metadata', 'Unsupported grant type');
  }
  if (Array.isArray(body.response_types) && body.response_types.some((type) => type !== 'code')) {
    return oauthError('invalid_client_metadata', 'Unsupported response type');
  }
  const uris = [...new Set(redirectUris as string[])];
  const issuedAt = now();
  return oauthJson(
    {
      // jti keeps two registrations with the same URIs in the same second distinct.
      client_id: await sign('claudiusz_client', { redirect_uris: uris, iat: issuedAt, jti: randomId() }, secret),
      client_id_issued_at: issuedAt,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
  );
}

async function validateAuthorizationParams(
  params: URLSearchParams,
  origin: string,
  secret: string,
): Promise<{ error: string } | Claims> {
  if (params.get('response_type') !== 'code') return { error: 'unsupported_response_type' };
  const clientId = params.get('client_id');
  const redirectUri = params.get('redirect_uri');
  const codeChallenge = params.get('code_challenge');
  const resource = params.get('resource') ?? `${origin}${MCP_PATH}`;
  if (!clientId || !redirectUri || !codeChallenge) return { error: 'invalid_request' };
  if (params.get('code_challenge_method') !== 'S256') return { error: 'invalid_request' };
  if (!validScope(params.get('scope'))) return { error: 'invalid_scope' };
  if (resource !== `${origin}${MCP_PATH}`) return { error: 'invalid_target' };
  const client = await verify(clientId, 'claudiusz_client', secret);
  if (!client || !Array.isArray(client.redirect_uris) || !client.redirect_uris.includes(redirectUri)) {
    return { error: 'invalid_client' };
  }
  return { clientId, redirectUri, challenge: codeChallenge, resource, state: params.get('state') };
}

async function authorize(request: Request, origin: string, secret: string): Promise<Response> {
  if (request.method === 'GET') {
    const validated = await validateAuthorizationParams(new URL(request.url).searchParams, origin, secret);
    if ('error' in validated) return oauthError(String(validated.error));
    const nonce = await sign('claudiusz_form', { ...validated, exp: now() + FORM_TTL_SECONDS }, secret);
    return loginPage(origin, nonce);
  }
  if (request.method !== 'POST') return oauthError('invalid_request', 'GET or POST required', 405);
  let values: URLSearchParams;
  try {
    values = new URLSearchParams(await limitedText(request));
  } catch (error) {
    return oauthError('invalid_request', error instanceof Error ? error.message : 'Invalid request');
  }
  const nonce = values.get('form_nonce') ?? '';
  const pending = await verifyTimed(nonce, 'claudiusz_form', secret);
  if (!pending || typeof pending.redirectUri !== 'string') {
    return oauthError('invalid_request', 'Authorization form expired');
  }
  const accessCode = (values.get('access_code') ?? '').trim();
  if (!(await constantTimeEqual(accessCode, secret))) return loginPage(origin, nonce, 'Invalid access code');
  const code = await sign(
    'claudiusz_code',
    {
      jti: randomId(),
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      challenge: pending.challenge,
      resource: pending.resource,
      exp: now() + AUTH_CODE_TTL_SECONDS,
    },
    secret,
  );
  const redirect = new URL(pending.redirectUri);
  redirect.searchParams.set('code', code);
  if (typeof pending.state === 'string' && pending.state) redirect.searchParams.set('state', pending.state);
  return new Response(null, { status: 302, headers: { 'Cache-Control': 'no-store', Location: redirect.toString() } });
}

async function token(request: Request, origin: string, secret: string): Promise<Response> {
  if (request.method !== 'POST') return oauthError('invalid_request', 'POST required', 405);
  let values: URLSearchParams;
  try {
    values = new URLSearchParams(await limitedText(request));
  } catch (error) {
    return oauthError('invalid_request', error instanceof Error ? error.message : 'Invalid request');
  }
  const resourceUrl = `${origin}${MCP_PATH}`;
  const clientId = values.get('client_id') ?? '';
  if (!(await verify(clientId, 'claudiusz_client', secret))) return oauthError('invalid_client', undefined, 401);

  const grantType = values.get('grant_type');
  if (grantType === 'authorization_code') {
    const pending = await verifyTimed(values.get('code'), 'claudiusz_code', secret);
    const verifier = values.get('code_verifier') ?? '';
    if (
      !pending ||
      pending.clientId !== clientId ||
      pending.redirectUri !== (values.get('redirect_uri') ?? '') ||
      pending.resource !== (values.get('resource') ?? resourceUrl) ||
      verifier.length < 43 ||
      verifier.length > 128 ||
      (await pkceChallenge(verifier)) !== pending.challenge
    ) {
      return oauthError('invalid_grant');
    }
    return tokenResponse(secret, clientId, resourceUrl);
  }
  if (grantType === 'refresh_token') {
    const claims = await verifyTimed(values.get('refresh_token'), 'claudiusz_rt', secret);
    if (
      !claims ||
      claims.typ !== 'refresh' ||
      claims.aud !== resourceUrl ||
      claims.scope !== OAUTH_SCOPE ||
      claims.client_id !== clientId
    ) {
      return oauthError('invalid_grant');
    }
    return tokenResponse(secret, clientId, resourceUrl);
  }
  return oauthError('unsupported_grant_type');
}

/** Handles discovery and /oauth/* routes; returns null for everything else. */
export async function handleOAuth(request: Request, secret: string | undefined): Promise<Response | null> {
  const url = new URL(request.url);
  const origin = url.origin;
  switch (url.pathname) {
    case '/.well-known/oauth-protected-resource':
    case `/.well-known/oauth-protected-resource${MCP_PATH}`:
      return oauthJson({
        resource: `${origin}${MCP_PATH}`,
        authorization_servers: [origin],
        scopes_supported: [OAUTH_SCOPE],
        bearer_methods_supported: ['header'],
        resource_name: 'Claudiusz69',
      });
    case '/.well-known/oauth-authorization-server':
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
    case '/oauth/register':
    case '/oauth/authorize':
    case '/oauth/token': {
      // Fail closed: no secret means nothing can be signed or verified.
      if (!secret) return oauthError('server_error', 'OAuth access code is not configured', 503);
      if (url.pathname === '/oauth/register') return register(request, secret);
      if (url.pathname === '/oauth/authorize') return authorize(request, origin, secret);
      return token(request, origin, secret);
    }
    default:
      return null;
  }
}
