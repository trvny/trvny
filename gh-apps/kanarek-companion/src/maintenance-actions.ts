import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const MAINTENANCE_PATH = '/gpt-actions/github/maintenance/report';
const NON_PROBLEM_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

type JsonObject = Record<string, unknown>;

class MaintenanceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'MaintenanceError';
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
    throw new MaintenanceError('repository_not_allowed', 403);
  }
  return value;
}

function repoPath(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
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
  if (text.length > 32_000) throw new MaintenanceError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new MaintenanceError('invalid_json');
  }
  if (!isObject(value)) throw new MaintenanceError('invalid_json_object');
  return value;
}

async function actionPayload(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new MaintenanceError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new MaintenanceError('invalid_action_response', 502);
  if (!response.ok) {
    throw new MaintenanceError(
      typeof value.error === 'string' ? value.error : 'action_failed',
      response.status,
    );
  }
  return value;
}

async function readData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<unknown> {
  const response = await handleGptActions(
    internalRequest(source, READ_PATH, { path }),
    env,
    fetcher,
  );
  return (await actionPayload(response)).data;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactPullRequest(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const head = isObject(value.head) ? value.head : {};
  const headRepo = isObject(head.repo) ? head.repo : {};
  return {
    number: numberValue(value.number),
    title: stringValue(value.title),
    draft: value.draft === true,
    headRef: stringValue(head.ref),
    headSha: stringValue(head.sha),
    headRepository: stringValue(headRepo.full_name),
    htmlUrl: stringValue(value.html_url),
    updatedAt: stringValue(value.updated_at),
  };
}

function compactRun(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  return {
    id: numberValue(value.id),
    name: stringValue(value.name),
    status: stringValue(value.status),
    conclusion: stringValue(value.conclusion),
    event: stringValue(value.event),
    headBranch: stringValue(value.head_branch),
    headSha: stringValue(value.head_sha),
    runAttempt: numberValue(value.run_attempt),
    htmlUrl: stringValue(value.html_url),
    updatedAt: stringValue(value.updated_at),
  };
}

export function workflowRunIsProblem(value: unknown): boolean {
  if (!isObject(value) || value.status !== 'completed' || typeof value.conclusion !== 'string') {
    return false;
  }
  return !NON_PROBLEM_CONCLUSIONS.has(value.conclusion);
}

export function unattachedBranches(
  branches: unknown[],
  openPullRequests: unknown[],
  repositoryName: string,
  defaultBranch: string,
): JsonObject[] {
  const activeHeads = new Set<string>();
  for (const raw of openPullRequests) {
    if (!isObject(raw) || !isObject(raw.head)) continue;
    const headRepo = isObject(raw.head.repo) ? raw.head.repo.full_name : null;
    if (headRepo === repositoryName && typeof raw.head.ref === 'string') {
      activeHeads.add(raw.head.ref);
    }
  }

  return branches
    .filter((raw) => {
      if (!isObject(raw) || typeof raw.name !== 'string') return false;
      return raw.name !== defaultBranch && raw.name !== 'gptomek/control' && !activeHeads.has(raw.name);
    })
    .map((raw) => {
      const branch = raw as JsonObject;
      const commit = isObject(branch.commit) ? branch.commit : {};
      return {
        name: stringValue(branch.name),
        headSha: stringValue(commit.sha),
        protected: branch.protected === true,
      };
    });
}

async function maintenanceReport(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const repo = repoPath(repositoryName);
  const [repositoryRaw, branchesRaw, pullsRaw, runsRaw, artifactsRaw, cacheRaw] = await Promise.all([
    readData(request, env, fetcher, `/repos/${repo}`),
    readData(request, env, fetcher, `/repos/${repo}/branches?per_page=100`),
    readData(request, env, fetcher, `/repos/${repo}/pulls?state=open&per_page=100`),
    readData(request, env, fetcher, `/repos/${repo}/actions/runs?per_page=50`),
    readData(request, env, fetcher, `/repos/${repo}/actions/artifacts?per_page=100`),
    readData(request, env, fetcher, `/repos/${repo}/actions/cache/usage`),
  ]);
  if (!isObject(repositoryRaw) || typeof repositoryRaw.default_branch !== 'string') {
    throw new MaintenanceError('invalid_repository_response', 502);
  }
  const branches = Array.isArray(branchesRaw) ? branchesRaw : [];
  const pulls = Array.isArray(pullsRaw) ? pullsRaw : [];
  const runs = isObject(runsRaw) && Array.isArray(runsRaw.workflow_runs) ? runsRaw.workflow_runs : [];
  const artifacts = isObject(artifactsRaw) && Array.isArray(artifactsRaw.artifacts) ? artifactsRaw.artifacts : [];
  const openPullRequests = pulls
    .map(compactPullRequest)
    .filter((entry): entry is JsonObject => Boolean(entry));
  const problemRuns = runs
    .filter(workflowRunIsProblem)
    .slice(0, 12)
    .map(compactRun)
    .filter((entry): entry is JsonObject => Boolean(entry));
  const listedArtifactBytes = artifacts.reduce((sum, artifact) => {
    return sum + (isObject(artifact) && typeof artifact.size_in_bytes === 'number' ? artifact.size_in_bytes : 0);
  }, 0);
  const expiredArtifacts = artifacts.filter((artifact) => isObject(artifact) && artifact.expired === true).length;

  return json({
    ok: true,
    repository: {
      name: repositoryName,
      defaultBranch: repositoryRaw.default_branch,
      archived: repositoryRaw.archived === true,
      visibility: stringValue(repositoryRaw.visibility),
    },
    branches: {
      listedCount: branches.length,
      truncated: branches.length === 100,
      unattached: unattachedBranches(branches, pulls, repositoryName, repositoryRaw.default_branch),
    },
    pullRequests: { open: openPullRequests },
    workflows: {
      listedCount: runs.length,
      recentProblemRuns: problemRuns,
    },
    artifacts: {
      totalCount: isObject(artifactsRaw) ? numberValue(artifactsRaw.total_count) : null,
      listedCount: artifacts.length,
      listedBytes: listedArtifactBytes,
      expiredListedCount: expiredArtifacts,
      truncated: isObject(artifactsRaw) && typeof artifactsRaw.total_count === 'number'
        ? artifactsRaw.total_count > artifacts.length
        : false,
    },
    cache: {
      activeCount: isObject(cacheRaw) ? numberValue(cacheRaw.active_caches_count) : null,
      activeBytes: isObject(cacheRaw) ? numberValue(cacheRaw.active_caches_size_in_bytes) : null,
    },
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

export function addMaintenanceOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[MAINTENANCE_PATH] = {
    post: {
      operationId: 'getRepositoryMaintenance',
      summary: 'Inspect repository maintenance state',
      description:
        'Returns open PRs, branches without open PRs, recent problematic workflow runs, artifact usage and active Actions cache usage without deleting anything.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository'],
              properties: { repository: { type: 'string', example: 'trvny/feedseek' } },
            },
          },
        },
      },
      responses: objectResponse('Repository maintenance report'),
    },
  };
}

export async function handleMaintenanceAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== MAINTENANCE_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await maintenanceReport(request, env, fetcher);
  } catch (error) {
    if (error instanceof MaintenanceError) return json({ ok: false, error: error.code }, error.status);
    console.error(
      JSON.stringify({
        gptMaintenance: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'maintenance_internal_error' }, 500);
  }
}
