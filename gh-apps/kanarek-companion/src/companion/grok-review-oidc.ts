import { createAppJwt, repositoryInstallationId } from '../../../core/github-app.ts';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = ISSUER + '/.well-known/jwks';
const AUDIENCE = 'https://automation.travny.workers.dev/grok-review/token';
const TRUSTED_REPOSITORY = 'travnie/.github';
const TRUSTED_REPOSITORY_ID = '1351772020';
const TRUSTED_WORKFLOW = TRUSTED_REPOSITORY + '/.github/workflows/grok-review.yml@refs/heads/main';
const TRUSTED_REF = 'refs/heads/main';
const ALLOWED_EVENTS = new Set(['repository_dispatch', 'workflow_dispatch']);
const REPOSITORY_RE = /^(?:trvny|travnie)\/[A-Za-z0-9_.-]+$/;

type JsonObject = Record<string, unknown>;
type OidcClaims = {
  aud?: unknown;
  iss?: unknown;
  exp?: unknown;
  iat?: unknown;
  nbf?: unknown;
  repository?: unknown;
  repository_id?: unknown;
  workflow_ref?: unknown;
  ref?: unknown;
  event_name?: unknown;
};

interface GrokTokenEnv {
  GPTOMEK_APP_ID?: string;
  GPTOMEK_PRIVATE_KEY?: string;
}

function objectValue(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function fromBase64Url(input: string): Uint8Array {
  if (!/^[a-zA-Z0-9_-]+$/.test(input)) throw new Error('invalid_base64url');
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  return Uint8Array.from(binary, (value) => value.charCodeAt(0));
}

function decodeJson(input: string): JsonObject {
  return objectValue(JSON.parse(new TextDecoder().decode(fromBase64Url(input))));
}

function claimsAllowed(claims: OidcClaims, nowSeconds: number): boolean {
  return claims.iss === ISSUER &&
    claims.aud === AUDIENCE &&
    claims.repository === TRUSTED_REPOSITORY &&
    String(claims.repository_id) === TRUSTED_REPOSITORY_ID &&
    claims.workflow_ref === TRUSTED_WORKFLOW &&
    claims.ref === TRUSTED_REF &&
    typeof claims.event_name === 'string' &&
    ALLOWED_EVENTS.has(claims.event_name) &&
    typeof claims.iat === 'number' &&
    claims.iat <= nowSeconds + 30 &&
    claims.iat > nowSeconds - 600 &&
    typeof claims.exp === 'number' &&
    claims.exp > nowSeconds &&
    claims.exp < nowSeconds + 900 &&
    (claims.nbf === undefined ||
      (typeof claims.nbf === 'number' && claims.nbf <= nowSeconds + 30));
}

export async function verifyGrokOidc(
  rawToken: string,
  fetcher: typeof fetch = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (rawToken.length > 12_000) return false;
  const parts = rawToken.split('.');
  if (parts.length !== 3) return false;

  try {
    const header = decodeJson(parts[0]);
    const claims = decodeJson(parts[1]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
      !claimsAllowed(claims, nowSeconds)) return false;

    const response = await fetcher(JWKS_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return false;
    const body = objectValue(await response.json());
    const keys = Array.isArray(body.keys) ? body.keys : [];
    const matching = keys.map(objectValue).find(
      (key) => key.kid === header.kid && key.kty === 'RSA' &&
        (key.use === undefined || key.use === 'sig'),
    );
    if (!matching || typeof matching.n !== 'string' || typeof matching.e !== 'string') {
      return false;
    }
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: matching.n, e: matching.e, ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      fromBase64Url(parts[2]),
      data,
    );
  } catch {
    return false;
  }
}

export function grokTokenTarget(value: unknown): string | null {
  const repository = objectValue(value).repository;
  return typeof repository === 'string' && REPOSITORY_RE.test(repository)
    ? repository
    : null;
}

export async function handleGrokTokenExchange(
  request: Request,
  env: GrokTokenEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const noStore = { 'cache-control': 'no-store' };
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: noStore });
  }
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([\w.-]+)$/i)?.[1];
  if (!bearer || !(await verifyGrokOidc(bearer, fetcher))) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: noStore });
  }
  let repository: string | null = null;
  try {
    const text = await request.text();
    if (text.length > 1024) return Response.json({ error: 'payload_too_large' }, { status: 413, headers: noStore });
    repository = grokTokenTarget(JSON.parse(text));
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400, headers: noStore });
  }
  if (!repository) {
    return Response.json({ error: 'invalid_repository' }, { status: 400, headers: noStore });
  }

  if (!env.GPTOMEK_APP_ID || !env.GPTOMEK_PRIVATE_KEY) {
    return Response.json({ error: 'app_unconfigured' }, { status: 503, headers: noStore });
  }

  try {
    const appJwt = await createAppJwt(env.GPTOMEK_APP_ID, env.GPTOMEK_PRIVATE_KEY);
    const installationId = await repositoryInstallationId(
      env.GPTOMEK_APP_ID, env.GPTOMEK_PRIVATE_KEY, repository, fetcher,
    );
    const [, repo] = repository.split('/');
    const response = await fetcher(
      'https://api.github.com/app/installations/' + installationId + '/access_tokens',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + appJwt,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          repositories: [repo],
          permissions: { contents: 'read', pull_requests: 'write' },
        }),
      },
    );
    if (!response.ok) {
      console.error(JSON.stringify({ grokTokenExchange: 'github_failed', status: response.status }));
      return Response.json({ error: 'github_token_unavailable' }, { status: 502, headers: noStore });
    }
    const result = objectValue(await response.json());
    const permissions = objectValue(result.permissions);
    if (typeof result.token !== 'string' ||
      typeof result.expires_at !== 'string' ||
      permissions.pull_requests !== 'write') {
      return Response.json({ error: 'insufficient_app_permissions' }, { status: 502, headers: noStore });
    }
    return Response.json(
      { token: result.token, expiresAt: result.expires_at },
      { headers: noStore },
    );
  } catch {
    return Response.json({ error: 'github_token_unavailable' }, { status: 502, headers: noStore });
  }
}
