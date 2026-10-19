// GitHub access as the caller (user OAuth token) or as gptomek[bot], behind the
// GPT Actions read/bot-write policy. One implementation for the HTTP routes
// (/gpt-actions/github/read|bot) and in-process callers (githubGateway).
import {
  createInstallationClient,
  GitHubApiError,
  gptomekInstallationIdFor,
  type GitHubInstallationClient,
  gptomekPrivateKey,
} from '../../core/github-app.ts';
import type { CompanionEnv } from './companion-types.ts';
import { REPOSITORY_OWNERS, repositoryInScope, repositoryPathInScope, CodedError, type JsonObject } from './tools/common.ts';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const EXPECTED_USER = 'trvny';
const MAX_ACTION_BODY = 256_000;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
const BOT_WRITE_ROOTS = new Set([
  'actions',
  'contents',
  'deployments',
  'dispatches',
  'git',
  'issues',
  'labels',
  'milestones',
  'pulls',
  'releases',
  'statuses',
]);
const BOT_DENIED_SEGMENTS = new Set([
  'collaborators',
  'environments',
  'hooks',
  'keys',
  'rulesets',
  'secrets',
  'variables',
]);

// code/status/details = the GPT Actions error envelope {ok:false,error,...details}.
export class GithubActionError extends CodedError {
  readonly details: JsonObject;

  constructor(code: string, status = 400, details: JsonObject = {}) {
    super(code, status);
    this.details = details;
  }

  envelope(): JsonObject {
    return { ok: false, error: this.code, ...this.details };
  }
}

// Any failure -> envelope-equivalent error. Unknown errors are logged once here.
export function githubActionError(error: unknown): GithubActionError {
  if (error instanceof GithubActionError) return error;
  if (error instanceof GitHubApiError) {
    return new GithubActionError(
      'github_api_error',
      error.status >= 400 && error.status < 600 ? error.status : 502,
      { operation: error.operation, status: error.status },
    );
  }
  console.error(
    JSON.stringify({
      gptActions: 'failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    }),
  );
  return new GithubActionError('internal_error', 500);
}

function githubHeaders(token: string): Headers {
  return new Headers({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'gremlin-gpt-actions',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  });
}

export function bearerToken(request: Request): string {
  const value = request.headers.get('authorization')?.trim() ?? '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new GithubActionError('missing_oauth_token', 401);
  return match[1];
}

export function requiredString(value: unknown, name: string, max = 65_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new GithubActionError(`invalid_${name}`);
  }
  return value;
}

function normalizeGithubPath(value: unknown): URL {
  const path = requiredString(value, 'github_path', 2_000);
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new GithubActionError('invalid_github_path');
  }
  const target = new URL(path, GITHUB_API);
  if (target.origin !== GITHUB_API) throw new GithubActionError('invalid_github_path');
  return target;
}

// Every user/org/repo qualifier must be in scope; at least one required.
function searchScopedToUser(target: URL): boolean {
  const qualifiers = (target.searchParams.get('q') ?? '')
    .split(/\s+/)
    .map((token) => token.match(/^-?(user|org|repo):(.+)$/i))
    .filter((match): match is RegExpMatchArray => match !== null);
  return (
    qualifiers.length > 0 &&
    qualifiers.every(([, kind, value]) =>
      kind.toLowerCase() === 'repo' ? repositoryInScope(value) : REPOSITORY_OWNERS.has(value),
    )
  );
}

export function githubReadAllowed(path: string): boolean {
  let target: URL;
  try {
    target = normalizeGithubPath(path);
  } catch {
    return false;
  }
  const pathname = target.pathname;
  return (
    pathname === '/user' ||
    pathname === '/user/repos' ||
    pathname === '/user/installations' ||
    pathname === '/users/trvny' ||
    pathname === '/users/trvny/repos' ||
    repositoryPathInScope(pathname) ||
    (pathname.startsWith('/search/') && searchScopedToUser(target))
  );
}

function botRepoRemainder(pathname: string): string[] | null {
  const match = pathname.match(/^\/repos\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (!match || !repositoryInScope(`${match[1]}/${match[2]}`)) return null;
  return match[3] ? match[3].split('/').filter(Boolean) : [];
}

function gitWriteAllowed(method: string, segments: string[], body: unknown): boolean {
  const area = segments[1];
  if (!area || !['refs', 'blobs', 'trees', 'commits'].includes(area)) return false;
  if (area === 'refs') {
    if (method === 'POST' && segments.length === 2) {
      const ref =
        body && typeof body === 'object' && !Array.isArray(body)
          ? (body as Record<string, unknown>).ref
          : null;
      return typeof ref === 'string' && ref.startsWith('refs/heads/');
    }
    if (method === 'PATCH') return segments[2] === 'heads' && segments.length >= 4;
    if (method === 'DELETE') return segments[2] === 'heads' && segments.length >= 4;
    return false;
  }
  return method === 'POST' && segments.length === 2;
}

export function githubBotRequestAllowed(
  methodValue: string,
  path: string,
  body: unknown = null,
): boolean {
  const method = methodValue.toUpperCase();
  if (!ALLOWED_METHODS.has(method)) return false;

  let target: URL;
  try {
    target = normalizeGithubPath(path);
  } catch {
    return false;
  }

  if (method === 'GET') {
    return (
      target.pathname === '/installation/repositories' ||
      repositoryPathInScope(target.pathname)
    );
  }

  const segments = botRepoRemainder(target.pathname);
  if (!segments?.length) return false;
  if (segments.some((segment) => BOT_DENIED_SEGMENTS.has(segment))) return false;
  const root = segments[0];
  if (!BOT_WRITE_ROOTS.has(root)) return false;

  if (root === 'pulls' && method === 'POST' && segments.length === 1) {
    return false;
  }
  if (root === 'git') return gitWriteAllowed(method, segments, body);
  if (root === 'actions') {
    return (
      method === 'POST' &&
      (segments[1] === 'runs' || segments[1] === 'workflows')
    );
  }
  if (root === 'contents') return method === 'PUT' || method === 'DELETE';
  if (root === 'statuses') return method === 'POST';
  if (root === 'dispatches') return method === 'POST';

  return ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
}

export async function userRequest(
  token: string,
  path: string,
  method = 'GET',
  body?: unknown,
  fetcher: typeof fetch = fetch,
): Promise<unknown> {
  const target = normalizeGithubPath(path);
  const response = await fetcher(target, {
    method,
    headers: githubHeaders(token),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { text: text.slice(0, 10_000) };
    }
  }
  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).message
        : null;
    throw new GithubActionError(
      typeof detail === 'string' ? `github_${response.status}_${detail}` : `github_${response.status}`,
      response.status,
    );
  }
  return payload;
}

export async function requireTrvny(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const payload = await userRequest(token, '/user', 'GET', undefined, fetcher);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new GithubActionError('invalid_github_user', 401);
  }
  const user = payload as Record<string, unknown>;
  if (user.login !== EXPECTED_USER) throw new GithubActionError('github_user_not_allowed', 403);
  return user;
}

export async function gptomekClient(
  env: CompanionEnv,
  fetcher: typeof fetch = fetch,
  repositoryName?: string,
): Promise<GitHubInstallationClient> {
  const appId = requiredString(env.GPTOMEK_APP_ID, 'gptomek_app_id', 30);
  const privateKey = gptomekPrivateKey(env, (value) =>
    requiredString(value, 'gptomek_private_key', 20_000),
  );
  const installationId = await gptomekInstallationIdFor(
    env.GPTOMEK_INSTALLATION_ID,
    appId,
    privateKey,
    repositoryName,
    fetcher,
  );
  if (installationId === null) {
    throw new GithubActionError('invalid_gptomek_installation_id', 503);
  }
  return createInstallationClient(appId, privateKey, installationId, fetcher);
}

function pathRepository(path: string): string | undefined {
  const match = new URL(path, GITHUB_API).pathname.match(/^\/repos\/([^/]+)\/([^/]+)/);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

// Read after the caller is authorized.
export async function readAuthorized(
  token: string,
  pathValue: unknown,
  fetcher: typeof fetch,
): Promise<unknown> {
  const path = requiredString(pathValue, 'github_path', 2_000);
  if (!githubReadAllowed(path)) throw new GithubActionError('github_read_path_not_allowed', 403);
  return userRequest(token, path, 'GET', undefined, fetcher);
}

export interface BotRequestInput {
  method?: unknown;
  path?: unknown;
  body?: unknown;
  expect?: unknown;
}

// gptomek[bot] request after the caller is authorized. expect 'empty' -> undefined.
export async function botAuthorized(
  input: BotRequestInput,
  env: CompanionEnv,
  fetcher: typeof fetch,
): Promise<unknown> {
  const method = requiredString(input.method, 'method', 10).toUpperCase();
  const path = requiredString(input.path, 'github_path', 2_000);
  const body = input.body;
  if (!githubBotRequestAllowed(method, path, body)) {
    throw new GithubActionError('github_bot_request_not_allowed', 403);
  }
  const client = await gptomekClient(env, fetcher, pathRepository(path));
  const init = { method, body: body === undefined ? undefined : JSON.stringify(body) };
  if (input.expect === 'empty') {
    await client.void(path, 'gpt_action_bot_request', init);
    return undefined;
  }
  return client.json<unknown>(path, 'gpt_action_bot_request', init);
}

// Read-only GraphQL after the caller is authorized.
export async function graphqlAuthorized(
  token: string,
  queryValue: unknown,
  variablesValue: unknown,
  fetcher: typeof fetch,
): Promise<unknown> {
  const query = requiredString(queryValue, 'query', 20_000);
  if (/\bmutation\b/i.test(query)) throw new GithubActionError('graphql_mutation_not_allowed', 403);
  const variables =
    variablesValue && typeof variablesValue === 'object' && !Array.isArray(variablesValue)
      ? variablesValue
      : {};
  return userRequest(token, '/graphql', 'POST', { query, variables }, fetcher);
}

export interface GithubGateway {
  read(path: string): Promise<unknown>;
  // null when the resource read returns 404.
  readOptional(path: string): Promise<{ data: unknown } | null>;
  graphql(query: string, variables?: JsonObject): Promise<unknown>;
  bot(method: string, path: string, body?: unknown): Promise<unknown>;
  botEmpty(method: string, path: string, body?: unknown): Promise<void>;
}

// In-process GitHub access as the caller of `source`. Same auth, policy and
// error codes/statuses as the /gpt-actions/github/read|bot routes; every
// failure is a GithubActionError. Auth runs per call (memoized by actionFetch).
export function githubGateway(
  source: Request,
  env: CompanionEnv,
  fetcher: typeof fetch = fetch,
): GithubGateway {
  const authorized = async <T>(work: (token: string) => Promise<T>): Promise<T> => {
    try {
      const token = bearerToken(source);
      await requireTrvny(token, fetcher);
      return await work(token);
    } catch (error) {
      throw githubActionError(error);
    }
  };
  // Same body cap as the HTTP route for payloads that may be large.
  const capped = (input: JsonObject) => {
    if (JSON.stringify(input).length > MAX_ACTION_BODY) {
      throw new GithubActionError('payload_too_large', 413);
    }
  };
  const bot = (input: BotRequestInput & JsonObject) =>
    authorized(() => {
      capped(input);
      return botAuthorized(input, env, fetcher);
    });
  const read = (path: string) => authorized((token) => readAuthorized(token, path, fetcher));
  return {
    read,
    // 404 from the resource only; auth failures propagate.
    readOptional: (path) =>
      authorized(async (token) => {
        try {
          return { data: await readAuthorized(token, path, fetcher) };
        } catch (error) {
          if (error instanceof GithubActionError && error.status === 404) return null;
          throw error;
        }
      }),
    graphql: (query, variables) =>
      authorized((token) => {
        capped({ query, ...(variables === undefined ? {} : { variables }) });
        return graphqlAuthorized(token, query, variables, fetcher);
      }),
    bot: (method, path, body) => bot({ method, path, ...(body === undefined ? {} : { body }) }),
    botEmpty: async (method, path, body) => {
      await bot({ method, path, ...(body === undefined ? {} : { body }), expect: 'empty' });
    },
  };
}

// Rethrow gateway failures as a module error with the same code, status and
// (optionally) the error envelope the HTTP route would have returned.
export async function mapGithubError<T>(
  work: Promise<T>,
  error: (code: string, status: number, envelope: JsonObject) => Error,
): Promise<T> {
  try {
    return await work;
  } catch (cause) {
    if (cause instanceof GithubActionError) throw error(cause.code, cause.status, cause.envelope());
    throw cause;
  }
}
