import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';
import { isProtectedBranch } from './gptomek.ts';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const READ_PATH = '/gpt-actions/github/read';
const BOT_PATH = '/gpt-actions/github/bot';
const CREATE_BRANCH_PATH = '/gpt-actions/github/branches/create';
const PR_STATE_PATH = '/gpt-actions/github/pull-requests/state';
const CLEANUP_BRANCH_PATH = '/gpt-actions/github/pull-requests/cleanup-branch';
const SHA_RE = /^[0-9a-f]{40}$/i;

type JsonObject = Record<string, unknown>;

class LifecycleError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'LifecycleError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new LifecycleError('repository_not_allowed', 403);
  }
  return value;
}

export function branchNameAllowed(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 250) return false;
  if (
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('..') ||
    value.includes('//') ||
    !/^[A-Za-z0-9._/-]+$/.test(value)
  ) {
    return false;
  }
  return value.split('/').every((part) => part && !part.endsWith('.lock'));
}

function branch(value: unknown): string {
  if (!branchNameAllowed(value)) throw new LifecycleError('invalid_branch');
  return value;
}

function expectedSha(value: unknown, name = 'expected_head_sha'): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new LifecycleError(`invalid_${name}`);
  }
  return value.toLowerCase();
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new LifecycleError(`invalid_${name}`);
  }
  return value;
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

function internalRequest(source: Request, pathname: string, body: JsonObject): Request {
  const url = new URL(source.url);
  url.pathname = pathname;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > 128_000) throw new LifecycleError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new LifecycleError('invalid_json');
  }
  if (!isObject(value)) throw new LifecycleError('invalid_json_object');
  return value;
}

async function responsePayload(response: Response): Promise<JsonObject> {
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    throw new LifecycleError('invalid_action_response', 502);
  }
  if (!isObject(payload)) throw new LifecycleError('invalid_action_response', 502);
  if (!response.ok) {
    throw new LifecycleError(
      typeof payload.error === 'string' ? payload.error : 'action_failed',
      response.status,
    );
  }
  return payload;
}

async function actionData(response: Response): Promise<unknown> {
  return (await responsePayload(response)).data;
}

async function readResponse(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<Response> {
  return handleGptActions(internalRequest(source, READ_PATH, { path }), env, fetcher);
}

async function readData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<unknown> {
  return actionData(await readResponse(source, env, fetcher, path));
}

async function botData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  method: string,
  path: string,
  body?: JsonObject,
): Promise<unknown> {
  return actionData(
    await handleGptActions(
      internalRequest(source, BOT_PATH, {
        method,
        path,
        ...(body ? { body } : {}),
      }),
      env,
      fetcher,
    ),
  );
}

async function botEmpty(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  method: string,
  path: string,
): Promise<void> {
  await responsePayload(
    await handleGptActions(
      internalRequest(source, BOT_PATH, { method, path, expect: 'empty' }),
      env,
      fetcher,
    ),
  );
}

function bearerToken(request: Request): string {
  const value = request.headers.get('authorization')?.trim() ?? '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new LifecycleError('missing_oauth_token', 401);
  return match[1];
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

async function userGithubRequest(
  token: string,
  path: string,
  method: string,
  body: unknown,
  fetcher: typeof fetch,
): Promise<unknown> {
  const target = new URL(path, GITHUB_API);
  if (target.origin !== GITHUB_API || !target.pathname.startsWith('/repos/trvny/') && target.pathname !== '/graphql') {
    throw new LifecycleError('github_user_write_not_allowed', 403);
  }
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
    const message = isObject(payload) && typeof payload.message === 'string' ? payload.message : null;
    throw new LifecycleError(
      message ? `github_${response.status}_${message}` : `github_${response.status}`,
      response.status,
    );
  }
  return payload;
}

function pullRequestSummary(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const head = isObject(value.head) ? value.head : {};
  const base = isObject(value.base) ? value.base : {};
  return {
    number: typeof value.number === 'number' ? value.number : null,
    state: typeof value.state === 'string' ? value.state : null,
    draft: value.draft === true,
    title: typeof value.title === 'string' ? value.title : null,
    headRef: typeof head.ref === 'string' ? head.ref : null,
    headSha: typeof head.sha === 'string' ? head.sha : null,
    baseRef: typeof base.ref === 'string' ? base.ref : null,
    mergedAt: typeof value.merged_at === 'string' ? value.merged_at : null,
    htmlUrl: typeof value.html_url === 'string' ? value.html_url : null,
  };
}

async function createBranchAsGptomek(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const branchName = branch(input.branch);
  const baseSha = expectedSha(input.baseSha, 'base_sha');
  const repo = repoPath(repositoryName);
  const repositoryRaw = await readData(request, env, fetcher, `/repos/${repo}`);
  if (!isObject(repositoryRaw) || typeof repositoryRaw.default_branch !== 'string') {
    throw new LifecycleError('invalid_repository_response', 502);
  }
  if (isProtectedBranch(branchName, repositoryRaw.default_branch)) {
    throw new LifecycleError('protected_branch', 403);
  }

  const existing = await readResponse(
    request,
    env,
    fetcher,
    `/repos/${repo}/git/ref/heads/${refPath(branchName)}`,
  );
  if (existing.ok) return json({ ok: false, error: 'branch_already_exists' }, 409);
  if (existing.status !== 404) await responsePayload(existing);

  const created = await botData(
    request,
    env,
    fetcher,
    'POST',
    `/repos/${repo}/git/refs`,
    { ref: `refs/heads/${branchName}`, sha: baseSha },
  );
  if (!isObject(created) || !isObject(created.object) || typeof created.object.sha !== 'string') {
    throw new LifecycleError('invalid_created_branch_response', 502);
  }
  return json({ ok: true, branch: branchName, sha: created.object.sha });
}

async function setPullRequestStateAsTrvny(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const pullRequestNumber = positiveInteger(input.pullRequestNumber, 'pull_request_number');
  const repo = repoPath(repositoryName);
  let current = await readData(request, env, fetcher, `/repos/${repo}/pulls/${pullRequestNumber}`);
  if (!isObject(current)) throw new LifecycleError('invalid_pull_request_response', 502);

  const restPatch: JsonObject = {};
  if (input.state !== undefined) {
    if (input.state !== 'open' && input.state !== 'closed') throw new LifecycleError('invalid_state');
    restPatch.state = input.state;
  }
  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 500) {
      throw new LifecycleError('invalid_title');
    }
    restPatch.title = input.title;
  }
  if (input.body !== undefined) {
    if (typeof input.body !== 'string' || input.body.length > 65_000) {
      throw new LifecycleError('invalid_body');
    }
    restPatch.body = input.body;
  }
  if (input.base !== undefined) restPatch.base = branch(input.base);
  if (input.draft !== undefined && typeof input.draft !== 'boolean') {
    throw new LifecycleError('invalid_draft');
  }
  if (!Object.keys(restPatch).length && input.draft === undefined) {
    throw new LifecycleError('no_pull_request_change');
  }
  if (restPatch.state === 'closed' && input.draft !== undefined) {
    throw new LifecycleError('draft_change_with_close_not_allowed');
  }

  const token = bearerToken(request);
  if (Object.keys(restPatch).length) {
    current = await userGithubRequest(
      token,
      `/repos/${repo}/pulls/${pullRequestNumber}`,
      'PATCH',
      restPatch,
      fetcher,
    );
    if (!isObject(current)) throw new LifecycleError('invalid_pull_request_response', 502);
  }

  if (typeof input.draft === 'boolean' && current.draft !== input.draft) {
    if (current.state !== 'open') throw new LifecycleError('draft_change_requires_open_pr', 409);
    const pullRequestId = typeof current.node_id === 'string' ? current.node_id : null;
    if (!pullRequestId) throw new LifecycleError('missing_pull_request_node_id', 502);
    const field = input.draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview';
    const query = `mutation($id: ID!) { ${field}(input: { pullRequestId: $id }) { pullRequest { id isDraft } } }`;
    await userGithubRequest(
      token,
      '/graphql',
      'POST',
      { query, variables: { id: pullRequestId } },
      fetcher,
    );
    current = await readData(request, env, fetcher, `/repos/${repo}/pulls/${pullRequestNumber}`);
  }

  return json({ ok: true, pullRequest: pullRequestSummary(current) });
}

async function cleanupPullRequestBranch(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const pullRequestNumber = positiveInteger(input.pullRequestNumber, 'pull_request_number');
  const branchName = branch(input.branch);
  const headSha = expectedSha(input.expectedHeadSha);
  const repo = repoPath(repositoryName);

  const [prRaw, repositoryRaw] = await Promise.all([
    readData(request, env, fetcher, `/repos/${repo}/pulls/${pullRequestNumber}`),
    readData(request, env, fetcher, `/repos/${repo}`),
  ]);
  if (!isObject(prRaw) || !isObject(repositoryRaw) || typeof repositoryRaw.default_branch !== 'string') {
    throw new LifecycleError('invalid_cleanup_context', 502);
  }
  if (prRaw.state !== 'closed') throw new LifecycleError('pull_request_still_open', 409);
  if (isProtectedBranch(branchName, repositoryRaw.default_branch)) {
    throw new LifecycleError('protected_branch', 403);
  }

  const head = isObject(prRaw.head) ? prRaw.head : {};
  const headRepo = isObject(head.repo) ? head.repo : null;
  if (head.ref !== branchName) throw new LifecycleError('pull_request_branch_mismatch', 409);
  if (typeof head.sha !== 'string' || head.sha.toLowerCase() !== headSha) {
    throw new LifecycleError('pull_request_head_changed', 409);
  }
  if (headRepo && typeof headRepo.full_name === 'string' && headRepo.full_name !== repositoryName) {
    throw new LifecycleError('pull_request_head_repo_mismatch', 409);
  }

  const refResponse = await readResponse(
    request,
    env,
    fetcher,
    `/repos/${repo}/git/ref/heads/${refPath(branchName)}`,
  );
  const merged = typeof prRaw.merged_at === 'string';
  if (refResponse.status === 404) {
    return json({ ok: true, deleted: false, alreadyAbsent: true, merged });
  }
  const refRaw = await actionData(refResponse);
  if (!isObject(refRaw) || !isObject(refRaw.object) || typeof refRaw.object.sha !== 'string') {
    throw new LifecycleError('invalid_branch_ref_response', 502);
  }
  if (refRaw.object.sha.toLowerCase() !== headSha) {
    throw new LifecycleError('branch_head_changed', 409);
  }

  await botEmpty(
    request,
    env,
    fetcher,
    'DELETE',
    `/repos/${repo}/git/refs/heads/${refPath(branchName)}`,
  );
  return json({ ok: true, deleted: true, alreadyAbsent: false, merged });
}

function objectResponse(description: string): JsonObject {
  return {
    '200': {
      description,
      content: {
        'application/json': { schema: { type: 'object', properties: {} } },
      },
    },
  };
}

function requestSchema(required: string[], properties: JsonObject): JsonObject {
  return {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', required, properties },
      },
    },
  };
}

export function addLifecycleOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[CREATE_BRANCH_PATH] = {
    post: {
      operationId: 'createBranchAsGptomek',
      summary: 'Create a branch as gptomek[bot]',
      description:
        'Creates a non-protected branch from an exact commit SHA. Use repository context to resolve the base SHA first.',
      requestBody: requestSchema(['repository', 'branch', 'baseSha'], {
        repository: { type: 'string', example: 'trvny/feedseek' },
        branch: { type: 'string' },
        baseSha: { type: 'string' },
      }),
      responses: objectResponse('Created branch'),
    },
  };
  paths[PR_STATE_PATH] = {
    post: {
      operationId: 'setPullRequestStateAsTrvny',
      summary: 'Update pull request state as trvny',
      description:
        'Updates title, body, base, open/closed state or draft/ready state using the authenticated trvny identity.',
      requestBody: requestSchema(['repository', 'pullRequestNumber'], {
        repository: { type: 'string' },
        pullRequestNumber: { type: 'integer', minimum: 1 },
        state: { type: 'string', enum: ['open', 'closed'] },
        title: { type: 'string' },
        body: { type: 'string' },
        base: { type: 'string' },
        draft: { type: 'boolean' },
      }),
      responses: objectResponse('Updated pull request'),
    },
  };
  paths[CLEANUP_BRANCH_PATH] = {
    post: {
      operationId: 'cleanupPullRequestBranch',
      summary: 'Safely delete a closed PR branch',
      description:
        'Deletes a closed or merged PR branch only when repository, branch and expected head SHA still match. Protected branches are rejected.',
      requestBody: requestSchema(
        ['repository', 'pullRequestNumber', 'branch', 'expectedHeadSha'],
        {
          repository: { type: 'string' },
          pullRequestNumber: { type: 'integer', minimum: 1 },
          branch: { type: 'string' },
          expectedHeadSha: { type: 'string' },
        },
      ),
      responses: objectResponse('Branch cleanup result'),
    },
  };
}

export async function handleLifecycleAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (![CREATE_BRANCH_PATH, PR_STATE_PATH, CLEANUP_BRANCH_PATH].includes(pathname)) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    if (pathname === CREATE_BRANCH_PATH) return createBranchAsGptomek(request, env, fetcher);
    if (pathname === PR_STATE_PATH) return setPullRequestStateAsTrvny(request, env, fetcher);
    return cleanupPullRequestBranch(request, env, fetcher);
  } catch (error) {
    if (error instanceof LifecycleError) return json({ ok: false, error: error.code }, error.status);
    console.error(
      JSON.stringify({
        gptLifecycle: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'lifecycle_internal_error' }, 500);
  }
}
