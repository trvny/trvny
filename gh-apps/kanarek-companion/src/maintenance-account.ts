import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';
import { unattachedBranches, workflowRunIsProblem } from './maintenance-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const ACCOUNT_MAINTENANCE_PATH = '/gpt-actions/github/maintenance/account';
const PAGE_SIZE = 100;
const MAX_REPOSITORIES = 200;
const REPOSITORY_CONCURRENCY = 4;

type JsonObject = Record<string, unknown>;

type ReadResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status: number };

export interface AccountRepositoryMaintenance {
  name: string;
  archived: boolean;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string | null;
  pullRequests: {
    openCount: number;
    truncated: boolean;
    items: JsonObject[];
  };
  branches: {
    listedCount: number;
    truncated: boolean;
    unattachedCount: number;
    unattached: JsonObject[];
  };
  workflows: {
    listedCount: number;
    problemCount: number;
    pendingCount: number;
    recentProblemRuns: JsonObject[];
    pendingRuns: JsonObject[];
  };
  cache: {
    activeCount: number | null;
    activeBytes: number | null;
  };
  attention: string[];
  errors: JsonObject[];
}

class AccountMaintenanceError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'AccountMaintenanceError';
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

function internalReadRequest(source: Request, path: string): Request {
  const url = new URL(source.url);
  url.pathname = READ_PATH;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path }),
  });
}

function errorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : '';
  const match = message.match(/^github_(\d{3})(?:_|$)/);
  return match ? Number(match[1]) : 502;
}

async function safeReadData(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<ReadResult> {
  try {
    const response = await handleGptActions(internalReadRequest(request, path), env, fetcher);
    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      return { ok: false, error: 'invalid_action_response', status: 502 };
    }
    if (!isObject(payload)) {
      return { ok: false, error: 'invalid_action_response', status: 502 };
    }
    if (!response.ok || payload.ok !== true) {
      return {
        ok: false,
        error: typeof payload.error === 'string' ? payload.error : 'action_failed',
        status: response.status,
      };
    }
    return { ok: true, data: payload.data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 300) : 'action_failed',
      status: errorStatus(error),
    };
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function repoPath(repository: string): string {
  return repository.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function compactPullRequest(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const head = isObject(value.head) ? value.head : {};
  return {
    number: numberValue(value.number),
    title: stringValue(value.title),
    draft: value.draft === true,
    headRef: stringValue(head.ref),
    headSha: stringValue(head.sha),
    updatedAt: stringValue(value.updated_at),
    htmlUrl: stringValue(value.html_url),
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
    htmlUrl: stringValue(value.html_url),
    updatedAt: stringValue(value.updated_at),
  };
}

function workflowRunIsPending(value: unknown): boolean {
  return isObject(value) && typeof value.status === 'string' && value.status !== 'completed';
}

export function accountMaintenanceAttention(
  unattachedCount: number,
  problemRunCount: number,
  errorCount: number,
): string[] {
  const flags: string[] = [];
  if (problemRunCount > 0) flags.push('workflow_problems');
  if (unattachedCount > 0) flags.push('unattached_branches');
  if (errorCount > 0) flags.push('partial_data');
  return flags;
}

function readError(area: string, result: ReadResult): JsonObject | null {
  if (result.ok) return null;
  return { area, status: result.status, error: result.error };
}

async function ownedRepositories(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<{ repositories: JsonObject[]; truncated: boolean }> {
  const repositories: JsonObject[] = [];

  for (let page = 1; repositories.length < MAX_REPOSITORIES; page += 1) {
    const result = await safeReadData(
      request,
      env,
      fetcher,
      `/user/repos?affiliation=owner&sort=full_name&per_page=${PAGE_SIZE}&page=${page}`,
    );
    if (!result.ok) throw new AccountMaintenanceError(result.error, result.status);
    if (!Array.isArray(result.data)) {
      throw new AccountMaintenanceError('invalid_repositories_response', 502);
    }
    const pageRepositories = result.data.filter(isObject);
    repositories.push(...pageRepositories);
    if (pageRepositories.length < PAGE_SIZE) {
      return { repositories, truncated: false };
    }
  }

  return {
    repositories: repositories.slice(0, MAX_REPOSITORIES),
    truncated: true,
  };
}

async function scanRepository(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repositoryRaw: JsonObject,
): Promise<AccountRepositoryMaintenance | null> {
  const name = stringValue(repositoryRaw.full_name);
  const defaultBranch = stringValue(repositoryRaw.default_branch);
  if (!name?.startsWith('trvny/') || !defaultBranch) return null;

  const repo = repoPath(name);
  const [branchesResult, pullsResult, runsResult, cacheResult] = await Promise.all([
    safeReadData(request, env, fetcher, `/repos/${repo}/branches?per_page=100`),
    safeReadData(request, env, fetcher, `/repos/${repo}/pulls?state=open&per_page=100`),
    safeReadData(request, env, fetcher, `/repos/${repo}/actions/runs?per_page=20`),
    safeReadData(request, env, fetcher, `/repos/${repo}/actions/cache/usage`),
  ]);

  const errors = [
    readError('branches', branchesResult),
    readError('pull_requests', pullsResult),
    readError('workflows', runsResult),
    readError('cache', cacheResult),
  ].filter((entry): entry is JsonObject => Boolean(entry));

  const branches = branchesResult.ok && Array.isArray(branchesResult.data)
    ? branchesResult.data
    : [];
  const pulls = pullsResult.ok && Array.isArray(pullsResult.data)
    ? pullsResult.data
    : [];
  const runEnvelope = runsResult.ok && isObject(runsResult.data) ? runsResult.data : {};
  const runs = Array.isArray(runEnvelope.workflow_runs) ? runEnvelope.workflow_runs : [];
  const cache = cacheResult.ok && isObject(cacheResult.data) ? cacheResult.data : {};

  const unattached = branchesResult.ok && pullsResult.ok
    ? unattachedBranches(branches, pulls, name, defaultBranch)
    : [];
  const problemRuns = runs.filter(workflowRunIsProblem);
  const pendingRuns = runs.filter(workflowRunIsPending);
  const pullItems = pulls
    .slice(0, 10)
    .map(compactPullRequest)
    .filter((entry): entry is JsonObject => Boolean(entry));
  const problemItems = problemRuns
    .slice(0, 5)
    .map(compactRun)
    .filter((entry): entry is JsonObject => Boolean(entry));
  const pendingItems = pendingRuns
    .slice(0, 5)
    .map(compactRun)
    .filter((entry): entry is JsonObject => Boolean(entry));

  return {
    name,
    archived: repositoryRaw.archived === true,
    private: repositoryRaw.private === true,
    defaultBranch,
    htmlUrl: stringValue(repositoryRaw.html_url),
    pullRequests: {
      openCount: pulls.length,
      truncated: pulls.length === 100,
      items: pullItems,
    },
    branches: {
      listedCount: branches.length,
      truncated: branches.length === 100,
      unattachedCount: unattached.length,
      unattached: unattached.slice(0, 10),
    },
    workflows: {
      listedCount: runs.length,
      problemCount: problemRuns.length,
      pendingCount: pendingRuns.length,
      recentProblemRuns: problemItems,
      pendingRuns: pendingItems,
    },
    cache: {
      activeCount: numberValue(cache.active_caches_count),
      activeBytes: numberValue(cache.active_caches_size_in_bytes),
    },
    attention: accountMaintenanceAttention(unattached.length, problemRuns.length, errors.length),
    errors,
  };
}

async function mapLimit<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < values.length) {
      const current = index;
      index += 1;
      output[current] = await mapper(values[current]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return output;
}

export function summarizeAccountMaintenance(
  repositories: AccountRepositoryMaintenance[],
): JsonObject {
  return repositories.reduce<JsonObject>(
    (summary, repository) => {
      summary.openPullRequests = Number(summary.openPullRequests) + repository.pullRequests.openCount;
      summary.unattachedBranches = Number(summary.unattachedBranches) + repository.branches.unattachedCount;
      summary.problemWorkflowRuns = Number(summary.problemWorkflowRuns) + repository.workflows.problemCount;
      summary.pendingWorkflowRuns = Number(summary.pendingWorkflowRuns) + repository.workflows.pendingCount;
      summary.activeCacheBytes = Number(summary.activeCacheBytes) + (repository.cache.activeBytes ?? 0);
      summary.repositoriesWithAttention =
        Number(summary.repositoriesWithAttention) + (repository.attention.length > 0 ? 1 : 0);
      summary.partialRepositories =
        Number(summary.partialRepositories) + (repository.errors.length > 0 ? 1 : 0);
      return summary;
    },
    {
      openPullRequests: 0,
      unattachedBranches: 0,
      problemWorkflowRuns: 0,
      pendingWorkflowRuns: 0,
      activeCacheBytes: 0,
      repositoriesWithAttention: 0,
      partialRepositories: 0,
    },
  );
}

async function accountMaintenance(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const owned = await ownedRepositories(request, env, fetcher);
  const archived = owned.repositories.filter((repository) => repository.archived === true);
  const active = owned.repositories.filter((repository) => repository.archived !== true);
  const scanned = await mapLimit(active, REPOSITORY_CONCURRENCY, (repository) =>
    scanRepository(request, env, fetcher, repository),
  );
  const repositories = scanned.filter(
    (entry): entry is AccountRepositoryMaintenance => Boolean(entry),
  );

  repositories.sort((left, right) => {
    const attention = Number(right.attention.length > 0) - Number(left.attention.length > 0);
    return attention || left.name.localeCompare(right.name);
  });

  return json({
    ok: true,
    account: 'trvny',
    repositoryCount: owned.repositories.length,
    scannedCount: repositories.length,
    archivedSkipped: archived
      .map((repository) => stringValue(repository.full_name))
      .filter((name): name is string => Boolean(name)),
    repositoriesTruncated: owned.truncated,
    summary: summarizeAccountMaintenance(repositories),
    repositories,
  });
}

export function addAccountMaintenanceOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[ACCOUNT_MAINTENANCE_PATH] = {
    post: {
      operationId: 'getAccountMaintenance',
      summary: 'Scan maintenance state across trvny repositories',
      description:
        'Scans active owned repositories for PR, branch, workflow and cache signals with bounded concurrency. Use getRepositoryMaintenance for detailed cleanup candidates.',
      responses: {
        '200': {
          description: 'Account maintenance report',
          content: {
            'application/json': {
              schema: { type: 'object', properties: {} },
            },
          },
        },
      },
    },
  };
}

export async function handleAccountMaintenanceAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== ACCOUNT_MAINTENANCE_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await accountMaintenance(request, env, fetcher);
  } catch (error) {
    if (error instanceof AccountMaintenanceError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        gptAccountMaintenance: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'account_maintenance_internal_error' }, 500);
  }
}
