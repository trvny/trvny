import { createAppJwt } from 'kanarek-companion/github-app';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
const TOKEN_MARGIN_MS = 5 * 60 * 1000;

export interface GitHubEnv {
  CLAUDIUSZ_APP_ID: string;
  ALLOWED_OWNERS: string;
  GH_APP_PRIVATE_KEY?: string;
}

export class ToolError extends Error {}

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Installation tokens live an hour and are the same for every caller in this
// isolate, so one per owner saves two GitHub round trips on each tool call.
const tokens = new Map<string, CachedToken>();

function headers(token: string): Headers {
  return new Headers({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'claudiusz-mcp',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  });
}

async function failure(response: Response, operation: string): Promise<never> {
  let message = '';
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string') message = body.message.slice(0, 300);
  } catch {
    // Non-JSON error body: the status has to do.
  }
  const needed = response.headers.get('x-accepted-github-permissions');
  throw new ToolError(
    `${operation} failed: HTTP ${response.status}${message ? ` — ${message}` : ''}${needed ? ` (needs: ${needed})` : ''}`,
  );
}

export function allowedOwner(env: GitHubEnv, owner: string): boolean {
  return env.ALLOWED_OWNERS.split(',')
    .map((entry) => entry.trim().toLowerCase())
    .includes(owner.toLowerCase());
}

async function appJwt(env: GitHubEnv): Promise<string> {
  if (!env.GH_APP_PRIVATE_KEY) throw new ToolError('GH_APP_PRIVATE_KEY is not set on the Worker');
  return createAppJwt(env.CLAUDIUSZ_APP_ID, env.GH_APP_PRIVATE_KEY);
}

async function installationToken(env: GitHubEnv, owner: string): Promise<string> {
  if (!allowedOwner(env, owner)) throw new ToolError(`owner not allowed: ${owner}`);

  const key = owner.toLowerCase();
  const cached = tokens.get(key);
  if (cached && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) return cached.token;

  const jwt = await appJwt(env);
  // /users/{owner}/installation resolves user accounts and organizations alike.
  const lookup = await fetch(`${GITHUB_API}/users/${encodeURIComponent(owner)}/installation`, {
    headers: headers(jwt),
  });
  if (!lookup.ok) await failure(lookup, `installation lookup for ${owner}`);
  const installation = (await lookup.json()) as { id?: unknown };
  if (typeof installation.id !== 'number') throw new ToolError(`no installation id for ${owner}`);

  const minted = await fetch(`${GITHUB_API}/app/installations/${installation.id}/access_tokens`, {
    method: 'POST',
    headers: headers(jwt),
  });
  if (!minted.ok) await failure(minted, 'create installation token');
  const body = (await minted.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof body.token !== 'string' || typeof body.expires_at !== 'string') {
    throw new ToolError('invalid installation token response');
  }
  tokens.set(key, { token: body.token, expiresAt: Date.parse(body.expires_at) });
  return body.token;
}

export async function rest<T>(
  env: GitHubEnv,
  owner: string,
  method: string,
  path: string,
  operation: string,
  body?: unknown,
): Promise<T> {
  const token = await installationToken(env, owner);
  const response = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: headers(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) await failure(response, operation);
  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
}

export async function graphql<T>(
  env: GitHubEnv,
  owner: string,
  query: string,
  variables: Record<string, unknown>,
  operation: string,
): Promise<T> {
  const payload = await rest<{ data?: T; errors?: { message?: string }[] }>(
    env,
    owner,
    'POST',
    '/graphql',
    operation,
    { query, variables },
  );
  if (payload.errors?.length) {
    throw new ToolError(`${operation} failed: ${payload.errors.map((e) => e.message).join('; ')}`);
  }
  if (!payload.data) throw new ToolError(`${operation} returned no data`);
  return payload.data;
}

export async function appIdentity(env: GitHubEnv): Promise<unknown> {
  const jwt = await appJwt(env);
  const [app, installs] = await Promise.all([
    fetch(`${GITHUB_API}/app`, { headers: headers(jwt) }),
    fetch(`${GITHUB_API}/app/installations`, { headers: headers(jwt) }),
  ]);
  if (!app.ok) await failure(app, 'get app');
  if (!installs.ok) await failure(installs, 'list installations');
  const appBody = (await app.json()) as { slug?: string; permissions?: unknown };
  const list = (await installs.json()) as {
    id: number;
    account?: { login?: string };
    repository_selection?: string;
  }[];
  return {
    login: `${appBody.slug}[bot]`,
    permissions: appBody.permissions,
    installations: list.map((entry) => ({
      id: entry.id,
      account: entry.account?.login,
      repositorySelection: entry.repository_selection,
      allowed: entry.account?.login ? allowedOwner(env, entry.account.login) : false,
    })),
  };
}
