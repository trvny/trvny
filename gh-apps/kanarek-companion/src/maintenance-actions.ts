import {
  createInstallationClient,
  type GitHubInstallationClient,
} from './github-app.ts';
import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const MAINTENANCE_PATH = '/gpt-actions/github/maintenance/report';
const ARTIFACT_DELETE_PATH = '/gpt-actions/github/maintenance/artifacts/delete';
const CACHE_DELETE_PATH = '/gpt-actions/github/maintenance/caches/delete';
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

function requiredString(value: unknown, name: string, max = 1_000): string {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new MaintenanceError(`invalid_${name}`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new MaintenanceError(`invalid_${name}`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new MaintenanceError(`invalid_${name}`);
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
  return (await actionPayload(await readResponse(source, env, fetcher, path))).data;
}

async function gptomekClient(
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<GitHubInstallationClient> {
  const appId = requiredString(env.GPTOMEK_APP_ID, 'gptomek_app_id', 30);
  const privateKey = requiredString(env.GPTOMEK_PRIVATE_KEY, 'gptomek_private_key', 20_000);
  const installationId = Number(env.GPTOMEK_INSTALLATION_ID);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new MaintenanceError('invalid_gptomek_installation_id', 503);
  }
  return createInstallationClient(appId, privateKey, installationId, fetcher);
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

function compactArtifact(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const workflowRun = isObject(value.workflow_run) ? value.workflow_run : {};
  return {
    id: numberValue(value.id),
    name: stringValue(value.name),
    sizeBytes: numberValue(value.size_in_bytes),
    expired: value.expired === true,
    createdAt: stringValue(value.created_at),
    updatedAt: stringValue(value.updated_at),
    expiresAt: stringValue(value.expires_at),
    workflowRunId: numberValue(workflowRun.id),
  };
}

function compactCache(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  return {
    id: numberValue(value.id),
    key: stringValue(value.key),
    ref: stringValue(value.ref),
    version: stringValue(value.version),
    sizeBytes: numberValue(value.size_in_bytes),
    createdAt: stringValue(value.created_at),
    lastAccessedAt: stringValue(value.last_accessed_at),
  };
}

export function artifactCleanupMatches(
  value: unknown,
  artifactId: number,
  expectedName: string,
  expectedSizeBytes: number,
): boolean {
  return (
    isObject(value) &&
    value.id === artifactId &&
    value.name === expectedName &&
    value.size_in_bytes === expectedSizeBytes
  );
}

export function cacheCleanupMatches(
  value: unknown,
  cacheId: number,
  expectedKey: string,
  expectedRef: string,
  expectedLastAccessedAt?: string,
): boolean {
  return (
    isObject(value) &&
    value.id === cacheId &&
    value.key === expectedKey &&
    value.ref === expectedRef &&
    (expectedLastAccessedAt === undefined || value.last_accessed_at === expectedLastAccessedAt)
  );
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
  const [repositoryRaw, branchesRaw, pullsRaw, runsRaw, artifactsRaw, cacheRaw, cachesRaw] =
    await Promise.all([
      readData(request, env, fetcher, `/repos/${repo}`),
      readData(request, env, fetcher, `/repos/${repo}/branches?per_page=100`),
      readData(request, env, fetcher, `/repos/${repo}/pulls?state=open&per_page=100`),
      readData(request, env, fetcher, `/repos/${repo}/actions/runs?per_page=50`),
      readData(request, env, fetcher, `/repos/${repo}/actions/artifacts?per_page=100`),
      readData(request, env, fetcher, `/repos/${repo}/actions/cache/usage`),
      readData(request, env, fetcher, `/repos/${repo}/actions/caches?per_page=100`),
    ]);
  if (!isObject(repositoryRaw) || typeof repositoryRaw.default_branch !== 'string') {
    throw new MaintenanceError('invalid_repository_response', 502);
  }
  const branches = Array.isArray(branchesRaw) ? branchesRaw : [];
  const pulls = Array.isArray(pullsRaw) ? pullsRaw : [];
  const runs = isObject(runsRaw) && Array.isArray(runsRaw.workflow_runs) ? runsRaw.workflow_runs : [];
  const artifacts =
    isObject(artifactsRaw) && Array.isArray(artifactsRaw.artifacts) ? artifactsRaw.artifacts : [];
  const caches =
    isObject(cachesRaw) && Array.isArray(cachesRaw.actions_caches) ? cachesRaw.actions_caches : [];
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
  const expiredArtifacts = artifacts.filter(
    (artifact) => isObject(artifact) && artifact.expired === true,
  ).length;
  const artifactItems = artifacts
    .slice(0, 30)
    .map(compactArtifact)
    .filter((entry): entry is JsonObject => Boolean(entry));
  const cacheItems = caches
    .slice(0, 30)
    .map(compactCache)
    .filter((entry): entry is JsonObject => Boolean(entry));

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
      items: artifactItems,
      truncated:
        isObject(artifactsRaw) && typeof artifactsRaw.total_count === 'number'
          ? artifactsRaw.total_count > artifacts.length
          : false,
    },
    cache: {
      activeCount: isObject(cacheRaw) ? numberValue(cacheRaw.active_caches_count) : null,
      activeBytes: isObject(cacheRaw) ? numberValue(cacheRaw.active_caches_size_in_bytes) : null,
      totalCount: isObject(cachesRaw) ? numberValue(cachesRaw.total_count) : null,
      listedCount: caches.length,
      items: cacheItems,
      truncated:
        isObject(cachesRaw) && typeof cachesRaw.total_count === 'number'
          ? cachesRaw.total_count > caches.length
          : false,
    },
  });
}

async function deleteMaintenanceArtifact(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const artifactId = positiveInteger(input.artifactId, 'artifact_id');
  const expectedName = requiredString(input.expectedName, 'expected_name', 500);
  const expectedSizeBytes = nonNegativeInteger(input.expectedSizeBytes, 'expected_size_bytes');
  const repo = repoPath(repositoryName);
  const artifactResponse = await readResponse(
    request,
    env,
    fetcher,
    `/repos/${repo}/actions/artifacts/${artifactId}`,
  );
  if (artifactResponse.status === 404) {
    return json({ ok: true, deleted: false, alreadyAbsent: true });
  }
  const artifactRaw = (await actionPayload(artifactResponse)).data;
  if (!artifactCleanupMatches(artifactRaw, artifactId, expectedName, expectedSizeBytes)) {
    throw new MaintenanceError('artifact_changed', 409);
  }

  const client = await gptomekClient(env, fetcher);
  await client.void(
    `/repos/${repo}/actions/artifacts/${artifactId}`,
    'gpt_action_delete_artifact',
    { method: 'DELETE' },
  );
  return json({
    ok: true,
    deleted: true,
    alreadyAbsent: false,
    artifact: compactArtifact(artifactRaw),
  });
}

async function deleteMaintenanceCache(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const cacheId = positiveInteger(input.cacheId, 'cache_id');
  const expectedKey = requiredString(input.expectedKey, 'expected_key', 1_000);
  const expectedRef = requiredString(input.expectedRef, 'expected_ref', 1_000);
  const expectedLastAccessedAt = input.expectedLastAccessedAt === undefined
    ? undefined
    : requiredString(input.expectedLastAccessedAt, 'expected_last_accessed_at', 100);
  const repo = repoPath(repositoryName);
  const cacheList = await readData(
    request,
    env,
    fetcher,
    `/repos/${repo}/actions/caches?per_page=100&key=${encodeURIComponent(expectedKey)}&ref=${encodeURIComponent(expectedRef)}`,
  );
  if (!isObject(cacheList) || !Array.isArray(cacheList.actions_caches)) {
    throw new MaintenanceError('invalid_cache_response', 502);
  }
  const cacheRaw = cacheList.actions_caches.find(
    (value) => isObject(value) && value.id === cacheId,
  );
  if (!cacheRaw) {
    return json({ ok: true, deleted: false, alreadyAbsent: true });
  }
  if (!cacheCleanupMatches(cacheRaw, cacheId, expectedKey, expectedRef, expectedLastAccessedAt)) {
    throw new MaintenanceError('cache_changed', 409);
  }

  const client = await gptomekClient(env, fetcher);
  await client.void(
    `/repos/${repo}/actions/caches/${cacheId}`,
    'gpt_action_delete_actions_cache',
    { method: 'DELETE' },
  );
  return json({
    ok: true,
    deleted: true,
    alreadyAbsent: false,
    cache: compactCache(cacheRaw),
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

export function addMaintenanceOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[MAINTENANCE_PATH] = {
    post: {
      operationId: 'getRepositoryMaintenance',
      summary: 'Inspect repository maintenance state',
      description:
        'Returns open PRs, unattached branches, problematic workflow runs, artifacts and Actions caches without deleting anything.',
      requestBody: requestSchema(['repository'], {
        repository: { type: 'string', example: 'trvny/feedseek' },
      }),
      responses: objectResponse('Repository maintenance report'),
    },
  };
  paths[ARTIFACT_DELETE_PATH] = {
    post: {
      operationId: 'deleteMaintenanceArtifact',
      summary: 'Delete one exact Actions artifact',
      description:
        'Deletes one artifact only when its current ID, name and byte size still match the maintenance snapshot.',
      requestBody: requestSchema(
        ['repository', 'artifactId', 'expectedName', 'expectedSizeBytes'],
        {
          repository: { type: 'string', example: 'trvny/feedseek' },
          artifactId: { type: 'integer', minimum: 1 },
          expectedName: { type: 'string' },
          expectedSizeBytes: { type: 'integer', minimum: 0 },
        },
      ),
      responses: objectResponse('Artifact cleanup result'),
    },
  };
  paths[CACHE_DELETE_PATH] = {
    post: {
      operationId: 'deleteMaintenanceCache',
      summary: 'Delete one exact Actions cache',
      description:
        'Deletes one Actions cache only when its current ID, key and ref still match the maintenance snapshot.',
      requestBody: requestSchema(['repository', 'cacheId', 'expectedKey', 'expectedRef'], {
        repository: { type: 'string', example: 'trvny/feedseek' },
        cacheId: { type: 'integer', minimum: 1 },
        expectedKey: { type: 'string' },
        expectedRef: { type: 'string' },
      }),
      responses: objectResponse('Cache cleanup result'),
    },
  };
}

export async function handleMaintenanceAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (![MAINTENANCE_PATH, ARTIFACT_DELETE_PATH, CACHE_DELETE_PATH].includes(pathname)) {
    return null;
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    if (pathname === ARTIFACT_DELETE_PATH) {
      return deleteMaintenanceArtifact(request, env, fetcher);
    }
    if (pathname === CACHE_DELETE_PATH) {
      return deleteMaintenanceCache(request, env, fetcher);
    }
    return maintenanceReport(request, env, fetcher);
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
