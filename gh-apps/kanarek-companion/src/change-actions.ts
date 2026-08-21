import { loadAgentGuidance, targetPaths } from './agents-guidance.ts';
import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';
import { branchNameAllowed, handleLifecycleAction } from './lifecycle-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const CREATE_BRANCH_PATH = '/gpt-actions/github/branches/create';
const PREPARE_CHANGE_PATH = '/gpt-actions/github/changes/prepare';
const SHA_RE = /^[0-9a-f]{40}$/i;

type JsonObject = Record<string, unknown>;

class ChangeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'ChangeError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new ChangeError('repository_not_allowed', 403);
  }
  return value;
}

function expectedSha(value: unknown): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new ChangeError('invalid_expected_base_sha');
  }
  return value.toLowerCase();
}

function branch(value: unknown): string {
  if (!branchNameAllowed(value)) throw new ChangeError('invalid_branch');
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ChangeError(`invalid_${name}`);
  }
  return value;
}

function repoPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function refPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function internalRequest(source: Request, pathname: string, body: JsonObject): Request {
  const url = new URL(source.url);
  url.pathname = pathname;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > 64_000) throw new ChangeError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new ChangeError('invalid_json');
  }
  if (!isObject(value)) throw new ChangeError('invalid_json_object');
  return value;
}

async function responsePayload(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new ChangeError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new ChangeError('invalid_action_response', 502);
  if (!response.ok) {
    throw new ChangeError(typeof value.error === 'string' ? value.error : 'action_failed', response.status);
  }
  return value;
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
  return (await responsePayload(await readResponse(source, env, fetcher, path))).data;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (isObject(entry) ? stringValue(entry.name) : null))
    .filter((entry): entry is string => Boolean(entry));
}

function compactIssue(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  return {
    number: numberValue(value.number),
    title: stringValue(value.title),
    state: stringValue(value.state),
    stateReason: stringValue(value.state_reason),
    isPullRequest: isObject(value.pull_request),
    labels: labelNames(value.labels),
    htmlUrl: stringValue(value.html_url),
    updatedAt: stringValue(value.updated_at),
  };
}

function compactPullRequest(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const head = isObject(value.head) ? value.head : {};
  const base = isObject(value.base) ? value.base : {};
  return {
    number: numberValue(value.number),
    title: stringValue(value.title),
    state: stringValue(value.state),
    draft: value.draft === true,
    headRef: stringValue(head.ref),
    headSha: stringValue(head.sha),
    baseRef: stringValue(base.ref),
    htmlUrl: stringValue(value.html_url),
    updatedAt: stringValue(value.updated_at),
  };
}

export function branchPullRequestConflict(pullRequests: unknown[], branchName: string): JsonObject | null {
  for (const value of pullRequests) {
    if (!isObject(value) || !isObject(value.head) || value.head.ref !== branchName) continue;
    return compactPullRequest(value);
  }
  return null;
}

async function readAgentFile(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repo: string,
  path: string,
  ref: string,
): Promise<unknown | null> {
  const response = await readResponse(
    request,
    env,
    fetcher,
    `/repos/${repo}/contents/${repoPath(path)}?ref=${encodeURIComponent(ref)}`,
  );
  if (response.status === 404) return null;
  return (await responsePayload(response)).data;
}

async function prepareChange(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const branchName = branch(input.branch);
  const baseSha = expectedSha(input.expectedBaseSha);
  const issue = input.issueNumber === undefined ? null : positiveInteger(input.issueNumber, 'issue_number');
  let targets: string[];
  try {
    targets = targetPaths(input.targetPaths);
  } catch {
    throw new ChangeError('invalid_target_paths');
  }
  const repo = repoPath(repositoryName);

  const repositoryRaw = await readData(request, env, fetcher, `/repos/${repo}`);
  if (!isObject(repositoryRaw) || typeof repositoryRaw.default_branch !== 'string') {
    throw new ChangeError('invalid_repository_response', 502);
  }
  const defaultBranch = repositoryRaw.default_branch;
  if (branchName === defaultBranch || branchName === 'main' || branchName === 'gptomek/control') {
    throw new ChangeError('protected_branch', 403);
  }

  const defaultRefRaw = await readData(
    request,
    env,
    fetcher,
    `/repos/${repo}/git/ref/heads/${refPath(defaultBranch)}`,
  );
  const currentBaseSha =
    isObject(defaultRefRaw) && isObject(defaultRefRaw.object) && typeof defaultRefRaw.object.sha === 'string'
      ? defaultRefRaw.object.sha.toLowerCase()
      : null;
  if (!currentBaseSha || !SHA_RE.test(currentBaseSha)) {
    throw new ChangeError('invalid_default_branch_ref', 502);
  }
  if (currentBaseSha !== baseSha) throw new ChangeError('base_head_changed', 409);

  const [branchPullRequestsRaw, openPullRequestsRaw] = await Promise.all([
    readData(
      request,
      env,
      fetcher,
      `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`trvny:${branchName}`)}&per_page=10`,
    ),
    readData(
      request,
      env,
      fetcher,
      `/repos/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=30`,
    ),
  ]);
  const branchPullRequests = Array.isArray(branchPullRequestsRaw) ? branchPullRequestsRaw : [];
  const openPullRequests = Array.isArray(openPullRequestsRaw) ? openPullRequestsRaw : [];
  const conflict = branchPullRequestConflict(branchPullRequests, branchName);
  if (conflict) return json({ ok: false, error: 'pull_request_already_exists', pullRequest: conflict }, 409);

  const branchResponse = await readResponse(
    request,
    env,
    fetcher,
    `/repos/${repo}/git/ref/heads/${refPath(branchName)}`,
  );
  if (branchResponse.ok) return json({ ok: false, error: 'branch_already_exists' }, 409);
  if (branchResponse.status !== 404) await responsePayload(branchResponse);

  const [agentGuidance, issueRaw] = await Promise.all([
    loadAgentGuidance(
      targets,
      baseSha,
      (path, ref) => readAgentFile(request, env, fetcher, repo, path, ref),
    ),
    issue === null
      ? Promise.resolve(null)
      : readData(request, env, fetcher, `/repos/${repo}/issues/${issue}`),
  ]);
  if (issueRaw !== null && !isObject(issueRaw)) throw new ChangeError('invalid_issue_response', 502);

  const createResponse = await handleLifecycleAction(
    internalRequest(request, CREATE_BRANCH_PATH, {
      repository: repositoryName,
      branch: branchName,
      baseSha,
    }),
    env,
    fetcher,
  );
  if (!createResponse) throw new ChangeError('branch_creation_route_missing', 502);
  const created = await responsePayload(createResponse);
  if (created.ok !== true || created.branch !== branchName || created.sha !== baseSha) {
    throw new ChangeError('branch_creation_not_confirmed', 502);
  }

  return json({
    ok: true,
    repository: {
      name: repositoryName,
      defaultBranch,
      baseSha,
      htmlUrl: stringValue(repositoryRaw.html_url),
    },
    branch: { name: branchName, sha: baseSha, created: true },
    agentInstructions: agentGuidance.root,
    agentGuidance,
    issue: compactIssue(issueRaw),
    openPullRequests: openPullRequests
      .slice(0, 30)
      .map(compactPullRequest)
      .filter((entry): entry is JsonObject => Boolean(entry)),
  });
}

function objectResponse(description: string): JsonObject {
  return {
    '200': {
      description,
      content: { 'application/json': { schema: { type: 'object', properties: {} } } },
    },
  };
}

export function addChangeOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[PREPARE_CHANGE_PATH] = {
    post: {
      operationId: 'prepareChange',
      summary: 'Preflight a change and create its branch',
      description:
        'Checks the exact current default-branch SHA and conflicts, loads applicable root/nested AGENTS.md for optional target files plus issue context, then creates a guarded GPTomek branch.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository', 'branch', 'expectedBaseSha'],
              properties: {
                repository: { type: 'string', example: 'trvny/feedseek' },
                branch: { type: 'string' },
                expectedBaseSha: { type: 'string' },
                issueNumber: { type: 'integer', minimum: 1 },
                targetPaths: {
                  type: 'array',
                  maxItems: 6,
                  items: { type: 'string' },
                  description: 'Repository-relative files expected to be edited; used to load applicable nested AGENTS.md files.',
                },
              },
            },
          },
        },
      },
      responses: objectResponse('Prepared change context'),
    },
  };
}

export async function handleChangeAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== PREPARE_CHANGE_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await prepareChange(request, env, fetcher);
  } catch (error) {
    if (error instanceof ChangeError) return json({ ok: false, error: error.code }, error.status);
    console.error(
      JSON.stringify({
        gptChange: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'change_internal_error' }, 500);
  }
}
