import {
  createInstallationClient,
  GitHubApiError,
  type GitHubInstallationClient,
} from './github-app.ts';
import type { CompanionEnv } from './companion-types.ts';
import { resolveGitTreeEntries, type GitTreeEntry } from './git-tree.ts';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const ACTIONS_PREFIX = '/gpt-actions';
const EXPECTED_USER = 'trvny';
const SHA_RE = /^[0-9a-f]{40}$/i;
const BOT_IDENTITY = {
  name: 'GPTomek',
  email: '314538226+gptomek[bot]@users.noreply.github.com',
};
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

export interface GptActionsEnv extends CompanionEnv {}

class ActionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'ActionError';
    this.code = code;
    this.status = status;
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
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

function bearerToken(request: Request): string {
  const value = request.headers.get('authorization')?.trim() ?? '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new ActionError('missing_oauth_token', 401);
  return match[1];
}

function requiredString(value: unknown, name: string, max = 65_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new ActionError(`invalid_${name}`);
  }
  return value;
}

function repository(value: unknown): string {
  const result = requiredString(value, 'repository', 200);
  const [owner, repo, extra] = result.split('/');
  if (
    extra ||
    owner !== EXPECTED_USER ||
    !repo ||
    !/^[A-Za-z0-9_.-]+$/.test(repo)
  ) {
    throw new ActionError('repository_not_allowed', 403);
  }
  return `${owner}/${repo}`;
}

function branch(value: unknown): string {
  const result = requiredString(value, 'branch', 250);
  if (
    result.startsWith('/') ||
    result.endsWith('/') ||
    result.includes('..') ||
    result.includes('//') ||
    !/^[A-Za-z0-9._/-]+$/.test(result)
  ) {
    throw new ActionError('invalid_branch');
  }
  return result;
}

function sha(value: unknown, name: string): string {
  const result = requiredString(value, name, 40);
  if (!SHA_RE.test(result)) throw new ActionError(`invalid_${name}`);
  return result.toLowerCase();
}

function filePath(value: unknown): string {
  const result = requiredString(value, 'path', 1_000);
  const parts = result.split('/');
  if (
    result.startsWith('/') ||
    result.endsWith('/') ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    parts[0] === '.git'
  ) {
    throw new ActionError('invalid_path');
  }
  return result;
}

function repoPath(repositoryName: string): string {
  return repositoryName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function refPath(branchName: string): string {
  return branchName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function normalizeGithubPath(value: unknown): URL {
  const path = requiredString(value, 'github_path', 2_000);
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new ActionError('invalid_github_path');
  }
  const target = new URL(path, GITHUB_API);
  if (target.origin !== GITHUB_API) throw new ActionError('invalid_github_path');
  return target;
}

function searchScopedToUser(target: URL): boolean {
  const query = target.searchParams.get('q') ?? '';
  return query.includes('user:trvny') || query.includes('repo:trvny/');
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
    pathname.startsWith('/repos/trvny/') ||
    (pathname.startsWith('/search/') && searchScopedToUser(target))
  );
}

function botRepoRemainder(pathname: string): string[] | null {
  const match = pathname.match(/^\/repos\/trvny\/([^/]+)(?:\/(.*))?$/);
  if (!match || !/^[A-Za-z0-9_.-]+$/.test(match[1])) return null;
  return match[2] ? match[2].split('/').filter(Boolean) : [];
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
      target.pathname.startsWith('/repos/trvny/')
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

async function readJsonBody(request: Request, maxBytes = 256_000): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new ActionError('payload_too_large', 413);
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ActionError('invalid_json');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActionError('invalid_json_object');
  }
  return value as Record<string, unknown>;
}

async function userRequest(
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
    throw new ActionError(
      typeof detail === 'string' ? `github_${response.status}_${detail}` : `github_${response.status}`,
      response.status,
    );
  }
  return payload;
}

async function requireTrvny(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  const payload = await userRequest(token, '/user', 'GET', undefined, fetcher);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ActionError('invalid_github_user', 401);
  }
  const user = payload as Record<string, unknown>;
  if (user.login !== EXPECTED_USER) throw new ActionError('github_user_not_allowed', 403);
  return user;
}

async function gptomekClient(
  env: GptActionsEnv,
  fetcher: typeof fetch = fetch,
): Promise<GitHubInstallationClient> {
  const appId = requiredString(env.GPTOMEK_APP_ID, 'gptomek_app_id', 30);
  const privateKey = requiredString(env.GPTOMEK_PRIVATE_KEY, 'gptomek_private_key', 20_000);
  const installationId = Number(env.GPTOMEK_INSTALLATION_ID);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new ActionError('invalid_gptomek_installation_id', 503);
  }
  return createInstallationClient(appId, privateKey, installationId, fetcher);
}

async function githubRead(
  request: Request,
  token: string,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await readJsonBody(request);
  const path = requiredString(input.path, 'github_path', 2_000);
  if (!githubReadAllowed(path)) throw new ActionError('github_read_path_not_allowed', 403);
  return json({ ok: true, data: await userRequest(token, path, 'GET', undefined, fetcher) });
}

async function githubBotRequest(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await readJsonBody(request);
  const method = requiredString(input.method, 'method', 10).toUpperCase();
  const path = requiredString(input.path, 'github_path', 2_000);
  const body = input.body;
  if (!githubBotRequestAllowed(method, path, body)) {
    throw new ActionError('github_bot_request_not_allowed', 403);
  }
  const expect = input.expect === 'empty' ? 'empty' : 'json';
  const client = await gptomekClient(env, fetcher);
  if (expect === 'empty') {
    await client.void(path, 'gpt_action_bot_request', {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return json({ ok: true });
  }
  const data = await client.json<unknown>(path, 'gpt_action_bot_request', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return json({ ok: true, data });
}

async function branchHead(
  client: GitHubInstallationClient,
  repositoryName: string,
  branchName: string,
): Promise<string> {
  const data = await client.json<{ object?: { sha?: string } }>(
    `/repos/${repoPath(repositoryName)}/git/ref/heads/${refPath(branchName)}`,
    'gpt_action_get_branch_ref',
  );
  const value = data.object?.sha;
  if (!value || !SHA_RE.test(value)) throw new ActionError('invalid_branch_ref_response', 502);
  return value.toLowerCase();
}

async function commitData(
  client: GitHubInstallationClient,
  repositoryName: string,
  commitSha: string,
): Promise<{ tree: { sha: string } }> {
  const data = await client.json<{ tree?: { sha?: string } }>(
    `/repos/${repoPath(repositoryName)}/git/commits/${commitSha}`,
    'gpt_action_get_commit',
  );
  if (!data.tree?.sha || !SHA_RE.test(data.tree.sha)) {
    throw new ActionError('invalid_commit_response', 502);
  }
  return { tree: { sha: data.tree.sha } };
}

type ContentTreeMode = '100644' | '100755' | '120000';

function explicitContentTreeMode(value: unknown): ContentTreeMode | undefined {
  if (value === undefined) return undefined;
  if (value !== '100644' && value !== '100755' && value !== '120000') {
    throw new ActionError('unsupported_file_mode', 409);
  }
  return value;
}

export function contentTreeMode(
  entry?: { mode?: unknown; type?: unknown },
  requestedMode?: unknown,
): ContentTreeMode {
  const requested = explicitContentTreeMode(requestedMode);
  if (!entry) return requested ?? '100644';
  if (
    entry.type !== 'blob' ||
    (entry.mode !== '100644' && entry.mode !== '100755' && entry.mode !== '120000')
  ) {
    throw new ActionError('unsupported_file_mode', 409);
  }
  if (requested && requested !== entry.mode) throw new ActionError('file_mode_change_not_allowed', 409);
  return entry.mode;
}

async function baseTreeEntries(
  client: GitHubInstallationClient,
  repositoryName: string,
  treeSha: string,
  paths: string[],
): Promise<Map<string, GitTreeEntry>> {
  return resolveGitTreeEntries(treeSha, paths, async (sha) => {
    const data = await client.json<{
      truncated?: boolean;
      tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string }>;
    }>(
      `/repos/${repoPath(repositoryName)}/git/trees/${sha}`,
      'gpt_action_get_base_tree',
    );
    if (data.truncated === true || !Array.isArray(data.tree)) {
      throw new ActionError('base_tree_not_readable', 502);
    }
    return data.tree.flatMap((entry): GitTreeEntry[] => {
      return typeof entry.path === 'string' &&
        typeof entry.mode === 'string' &&
        typeof entry.type === 'string' &&
        typeof entry.sha === 'string' &&
        SHA_RE.test(entry.sha)
        ? [{ path: entry.path, mode: entry.mode, type: entry.type, sha: entry.sha.toLowerCase() }]
        : [];
    });
  });
}

async function commitFiles(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await readJsonBody(request, 2_000_000);
  const repositoryName = repository(input.repository);
  const branchName = branch(input.branch);
  const expectedHeadSha = sha(input.expectedHeadSha, 'expected_head_sha');
  const message = requiredString(input.message, 'message', 1_500);
  if (!Array.isArray(input.files) || !input.files.length || input.files.length > 32) {
    throw new ActionError('invalid_files');
  }
  const files = input.files.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ActionError('invalid_file');
    }
    const file = value as Record<string, unknown>;
    if (file.content !== null && typeof file.content !== 'string') {
      throw new ActionError('invalid_file_content');
    }
    if (typeof file.content === 'string' && file.content.length > 96_000) {
      throw new ActionError('file_content_too_large');
    }
    return {
      path: filePath(file.path),
      content: file.content as string | null,
      mode: explicitContentTreeMode(file.mode),
    };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new ActionError('duplicate_file_path');
  }

  const client = await gptomekClient(env, fetcher);
  const currentHead = await branchHead(client, repositoryName, branchName);
  if (currentHead !== expectedHeadSha) throw new ActionError('branch_head_changed', 409);
  const baseCommit = await commitData(client, repositoryName, expectedHeadSha);
  const baseEntries = await baseTreeEntries(client, repositoryName, baseCommit.tree.sha, files.map((file) => file.path));

  const tree = await Promise.all(
    files.map(async (file) => {
      const mode = contentTreeMode(baseEntries.get(file.path), file.mode);
      if (file.content === null) {
        return { path: file.path, mode, type: 'blob', sha: null };
      }
      const blob = await client.json<{ sha?: string }>(
        `/repos/${repoPath(repositoryName)}/git/blobs`,
        'gpt_action_create_blob',
        {
          method: 'POST',
          body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
        },
      );
      if (!blob.sha || !SHA_RE.test(blob.sha)) throw new ActionError('invalid_created_blob', 502);
      return { path: file.path, mode, type: 'blob', sha: blob.sha };
    }),
  );

  const createdTree = await client.json<{ sha?: string }>(
    `/repos/${repoPath(repositoryName)}/git/trees`,
    'gpt_action_create_tree',
    {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    },
  );
  if (!createdTree.sha || !SHA_RE.test(createdTree.sha)) {
    throw new ActionError('invalid_created_tree', 502);
  }

  const createdCommit = await client.json<{ sha?: string }>(
    `/repos/${repoPath(repositoryName)}/git/commits`,
    'gpt_action_create_commit',
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: createdTree.sha,
        parents: [expectedHeadSha],
        author: BOT_IDENTITY,
        committer: BOT_IDENTITY,
      }),
    },
  );
  if (!createdCommit.sha || !SHA_RE.test(createdCommit.sha)) {
    throw new ActionError('invalid_created_commit', 502);
  }
  const newSha = createdCommit.sha.toLowerCase();
  await client.json<unknown>(
    `/repos/${repoPath(repositoryName)}/git/refs/heads/${refPath(branchName)}`,
    'gpt_action_update_branch',
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: newSha, force: false }),
    },
  );
  return json({ ok: true, sha: newSha });
}

async function createPullRequest(
  request: Request,
  token: string,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await readJsonBody(request);
  const repositoryName = repository(input.repository);
  const title = requiredString(input.title, 'title', 500);
  const head = branch(input.head);
  const base = branch(input.base);
  const body = typeof input.body === 'string' ? input.body : '';
  if (body.length > 65_000) throw new ActionError('invalid_body');
  const draft = input.draft === true;
  const data = await userRequest(
    token,
    `/repos/${repoPath(repositoryName)}/pulls`,
    'POST',
    { title, head, base, body, draft, maintainer_can_modify: true },
    fetcher,
  );
  return json({ ok: true, data });
}

async function graphqlRead(
  request: Request,
  token: string,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await readJsonBody(request);
  const query = requiredString(input.query, 'query', 20_000);
  if (/\bmutation\b/i.test(query)) throw new ActionError('graphql_mutation_not_allowed', 403);
  const variables =
    input.variables && typeof input.variables === 'object' && !Array.isArray(input.variables)
      ? input.variables
      : {};
  const data = await userRequest(token, '/graphql', 'POST', { query, variables }, fetcher);
  return json({ ok: true, data });
}

async function setReviewThreadResolved(
  request: Request,
  token: string,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await readJsonBody(request);
  const threadId = requiredString(input.threadId, 'thread_id', 200);
  const resolved = input.resolved !== false;
  const field = resolved ? 'resolveReviewThread' : 'unresolveReviewThread';
  const mutation = `mutation($threadId: ID!) { ${field}(input: { threadId: $threadId }) { thread { id isResolved } } }`;
  const data = await userRequest(
    token,
    '/graphql',
    'POST',
    { query: mutation, variables: { threadId } },
    fetcher,
  );
  return json({ ok: true, data });
}

async function whoAmI(
  token: string,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const user = await requireTrvny(token, fetcher);
  const client = await gptomekClient(env, fetcher);
  return json({
    ok: true,
    user: { login: user.login, id: user.id },
    bot: {
      login: 'gptomek[bot]',
      expiresAt: client.expiresAt,
      permissions: client.permissions,
    },
  });
}

async function oauthTokenProxy(request: Request, fetcher: typeof fetch): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const raw = await request.text();
  if (raw.length > 32_000) return json({ error: 'payload_too_large' }, 413);
  const contentType = request.headers.get('content-type') ?? '';
  let values = new URLSearchParams();
  try {
    if (contentType.includes('application/json')) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of [
        'client_id',
        'client_secret',
        'code',
        'redirect_uri',
        'grant_type',
        'refresh_token',
      ]) {
        if (typeof parsed[key] === 'string') values.set(key, parsed[key] as string);
      }
    } else {
      values = new URLSearchParams(raw);
    }
  } catch {
    return json({ error: 'invalid_oauth_payload' }, 400);
  }
  const response = await fetcher('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'gremlin-gpt-actions',
    },
    body: values.toString(),
  });
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

export function openApiDocument(origin: string): Record<string, unknown> {
  const jsonResponse = {
    '200': {
      description: 'Successful response',
      content: { 'application/json': { schema: { type: 'object' } } },
    },
  };
  return {
    openapi: '3.1.0',
    info: {
      title: 'Gremlin Operator',
      version: '1.0.0',
      description:
        'Guarded operator for trvny GitHub repositories and selected Cloudflare resources. Uses trvny OAuth for authorization and server-side provider credentials for narrow external actions.',
    },
    servers: [{ url: origin }],
    security: [{ githubOAuth: [] }],
    paths: {
      [`${ACTIONS_PREFIX}/whoami`]: {
        get: {
          operationId: 'whoAmI',
          summary: 'Verify GitHub identities and current GPTomek permissions',
          responses: jsonResponse,
        },
      },
      [`${ACTIONS_PREFIX}/github/read`]: {
        post: {
          operationId: 'githubRead',
          summary: 'Read GitHub REST API data as trvny',
          description:
            'Use for repository, PR, issue, file, commit, branch, check, workflow, release and search reads. Path must be a GitHub REST path scoped to trvny.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['path'],
                  properties: {
                    path: {
                      type: 'string',
                      description:
                        'GitHub REST path including optional query string, e.g. /repos/trvny/feedseek/pulls?state=open or /search/issues?q=user%3Atrvny+is%3Apr+is%3Aopen',
                    },
                  },
                },
              },
            },
          },
          responses: jsonResponse,
        },
      },
      [`${ACTIONS_PREFIX}/github/bot`]: {
        post: {
          operationId: 'githubBotRequest',
          summary: 'Call an allowlisted GitHub REST operation as gptomek[bot]',
          description:
            'Use for comments, review replies, reactions, labels, issue/PR updates, merge, workflow reruns/dispatch, releases and uncommon repository operations. Creating pull requests as the bot is blocked; use createPullRequestAsTrvny. Set expect=empty for GitHub endpoints that return 204.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['method', 'path'],
                  properties: {
                    method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'] },
                    path: { type: 'string' },
                    body: {},
                    expect: { type: 'string', enum: ['json', 'empty'], default: 'json' },
                  },
                },
              },
            },
          },
          responses: jsonResponse,
        },
      },
      [`${ACTIONS_PREFIX}/github/commit-files`]: {
        post: {
          operationId: 'commitFilesAsGptomek',
          summary: 'Atomically commit up to 32 text-file changes as GPTomek',
          description:
            'Preferred way to edit repository files. Requires the expected branch head SHA to prevent overwriting concurrent work. content=null deletes a file.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['repository', 'branch', 'expectedHeadSha', 'message', 'files'],
                  properties: {
                    repository: { type: 'string', example: 'trvny/feedseek' },
                    branch: { type: 'string' },
                    expectedHeadSha: { type: 'string' },
                    message: { type: 'string' },
                    files: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 32,
                      items: {
                        type: 'object',
                        required: ['path', 'content'],
                        properties: {
                          path: { type: 'string' },
                          content: { type: ['string', 'null'] },
                          mode: {
                            type: 'string',
                            enum: ['100644', '100755', '120000'],
                            description: 'Optional mode for a newly created path. Existing file modes cannot be changed here.',
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: jsonResponse,
        },
      },
      [`${ACTIONS_PREFIX}/github/pull-requests`]: {
        post: {
          operationId: 'createPullRequestAsTrvny',
          summary: 'Open a pull request as trvny',
          description:
            'Use this instead of bot PR creation so external automatic reviews that depend on the human author still trigger.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['repository', 'title', 'head', 'base'],
                  properties: {
                    repository: { type: 'string' },
                    title: { type: 'string' },
                    head: { type: 'string' },
                    base: { type: 'string' },
                    body: { type: 'string' },
                    draft: { type: 'boolean', default: false },
                  },
                },
              },
            },
          },
          responses: jsonResponse,
        },
      },
      [`${ACTIONS_PREFIX}/github/graphql`]: {
        post: {
          operationId: 'githubGraphqlRead',
          summary: 'Run a read-only GitHub GraphQL query as trvny',
          description:
            'Use for data not exposed conveniently by REST, including review thread IDs and resolved state. Mutations are rejected.',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['query'],
                  properties: {
                    query: { type: 'string' },
                    variables: { type: 'object', additionalProperties: true },
                  },
                },
              },
            },
          },
          responses: jsonResponse,
        },
      },
      [`${ACTIONS_PREFIX}/github/review-threads/state`]: {
        post: {
          operationId: 'setReviewThreadResolvedAsTrvny',
          summary: 'Resolve or reopen an inline pull-request review thread as trvny',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['threadId', 'resolved'],
                  properties: {
                    threadId: { type: 'string' },
                    resolved: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: jsonResponse,
        },
      },
    },
    components: {
      securitySchemes: {
        githubOAuth: {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: 'https://github.com/login/oauth/authorize',
              tokenUrl: `${origin}${ACTIONS_PREFIX}/oauth/token`,
              scopes: {},
            },
          },
        },
      },
    },
  };
}

function privacyPolicy(origin: string): Response {
  const text = [
    'Gremlin GitHub Actions privacy policy',
    '',
    'This private gateway forwards authenticated requests to GitHub and does not intentionally store OAuth tokens or request bodies.',
    'Cloudflare and GitHub may retain normal infrastructure logs and metadata under their respective policies.',
    `Service: ${origin}`,
  ].join('\n');
  return new Response(text, {
    headers: {
      'cache-control': 'public, max-age=3600',
      'content-type': 'text/plain; charset=utf-8',
    },
  });
}

function actionFailure(error: unknown): Response {
  if (error instanceof ActionError) return json({ ok: false, error: error.code }, error.status);
  if (error instanceof GitHubApiError) {
    return json(
      { ok: false, error: 'github_api_error', operation: error.operation, status: error.status },
      error.status >= 400 && error.status < 600 ? error.status : 502,
    );
  }
  console.error(
    JSON.stringify({
      gptActions: 'failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    }),
  );
  return json({ ok: false, error: 'internal_error' }, 500);
}

export async function handleGptActions(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${ACTIONS_PREFIX}/`) && url.pathname !== ACTIONS_PREFIX) {
    return json({ error: 'not_found' }, 404);
  }

  if (url.pathname === `${ACTIONS_PREFIX}/openapi.json`) {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    return json(openApiDocument(url.origin));
  }
  if (url.pathname === `${ACTIONS_PREFIX}/privacy`) {
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    return privacyPolicy(url.origin);
  }
  if (url.pathname === `${ACTIONS_PREFIX}/oauth/token`) {
    return oauthTokenProxy(request, fetcher);
  }

  try {
    const token = bearerToken(request);
    await requireTrvny(token, fetcher);

    if (url.pathname === `${ACTIONS_PREFIX}/whoami` && request.method === 'GET') {
      return whoAmI(token, env, fetcher);
    }
    if (url.pathname === `${ACTIONS_PREFIX}/github/read` && request.method === 'POST') {
      return githubRead(request, token, fetcher);
    }
    if (url.pathname === `${ACTIONS_PREFIX}/github/bot` && request.method === 'POST') {
      return githubBotRequest(request, env, fetcher);
    }
    if (url.pathname === `${ACTIONS_PREFIX}/github/commit-files` && request.method === 'POST') {
      return commitFiles(request, env, fetcher);
    }
    if (url.pathname === `${ACTIONS_PREFIX}/github/pull-requests` && request.method === 'POST') {
      return createPullRequest(request, token, fetcher);
    }
    if (url.pathname === `${ACTIONS_PREFIX}/github/graphql` && request.method === 'POST') {
      return graphqlRead(request, token, fetcher);
    }
    if (
      url.pathname === `${ACTIONS_PREFIX}/github/review-threads/state` &&
      request.method === 'POST'
    ) {
      return setReviewThreadResolved(request, token, fetcher);
    }
    return json({ error: 'not_found' }, 404);
  } catch (error) {
    return actionFailure(error);
  }
}
