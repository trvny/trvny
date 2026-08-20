import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const BOOTSTRAP_PATH = '/gpt-actions/operator/bootstrap';
const POLICY_REPOSITORY = 'trvny/trvny';
const POLICY_PATH = '.ai/private/openai/gremlin-policy.json';
const POLICY_REF = 'main';
const MAX_POLICY_BYTES = 32_000;
const MAX_AGENTS_BYTES = 24_000;
const DEFAULT_CACHE_MAX_BYTES = 5 * 1024 * 1024 * 1024;
const DEFAULT_CACHE_STALE_DAYS = 5;
const MIN_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_MAX_BYTES = 100 * 1024 * 1024 * 1024;

type JsonObject = Record<string, unknown>;
type Autonomy = 'low' | 'medium' | 'high';
type OperatingMode = 'ask_first' | 'plan_then_act' | 'act_then_report';
type MergeMethod = 'merge' | 'squash' | 'rebase';

export interface MaintenanceRepositoryOverride {
  repository: string;
  autofix?: boolean;
  workflowRetries?: number;
  cacheMaxBytes?: number;
  cacheStaleDays?: number;
}

export interface GremlinPolicy {
  version: 1;
  model: {
    autonomy: Autonomy;
    operatingMode: OperatingMode;
    stopConditions: string[];
    preferredActions: string[];
  };
  runtime: {
    repositories: {
      include: string[];
      exclude: string[];
      skipArchived: boolean;
    };
    maintenance: {
      autofix: boolean;
      maxRepositoriesPerRun: number;
      maxFixesPerRun: number;
      workflowRetries: number;
      cacheMaxBytes: number;
      cacheStaleDays: number;
      repositoryOverrides: MaintenanceRepositoryOverride[];
    };
    merge: {
      enabled: boolean;
      method: MergeMethod;
      requireGreenCi: boolean;
      requireNoActionableReviews: boolean;
      requireExpectedHeadSha: boolean;
    };
    release: {
      allowedBranches: string[];
      requireExpectedTargetSha: boolean;
    };
  };
}

export interface LoadedGremlinPolicy {
  policy: GremlinPolicy;
  source: {
    repository: string;
    path: string;
    ref: string;
    sha: string;
  };
}

class PolicyActionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'PolicyActionError';
    this.code = code;
    this.status = status;
  }
}

const GATEWAY_CAPABILITIES = [
  'repository_context',
  'change_preparation',
  'code_investigation',
  'pull_request_lifecycle',
  'issue_triage',
  'workflow_control',
  'release_control',
  'maintenance_scan',
  'maintenance_autofix',
] as const;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function policyError(path: string): never {
  const normalized = path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
  throw new PolicyActionError(`invalid_policy_${normalized || 'root'}`, 422);
}

function exactObject(value: unknown, keys: readonly string[], path: string): JsonObject {
  if (!isObject(value)) policyError(path);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) policyError(`${path}_${key}`);
  }
  return value;
}

function enumString<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) policyError(path);
  return value as T;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') policyError(path);
  return value;
}

function integerValue(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    policyError(path);
  }
  return value;
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  return value === undefined ? undefined : booleanValue(value, path);
}

function optionalInteger(
  value: unknown,
  min: number,
  max: number,
  path: string,
): number | undefined {
  return value === undefined ? undefined : integerValue(value, min, max, path);
}

function stringList(
  value: unknown,
  path: string,
  pattern: RegExp,
  maxItems = 32,
): string[] {
  if (!Array.isArray(value) || value.length > maxItems) policyError(path);
  const result = value.map((entry, index) => {
    if (typeof entry !== 'string' || !entry || entry.length > 200 || !pattern.test(entry)) {
      policyError(`${path}_${index}`);
    }
    return entry;
  });
  if (new Set(result).size !== result.length) policyError(`${path}_duplicate`);
  return result;
}

function repositoryPatterns(value: unknown, path: string): string[] {
  return stringList(value, path, /^trvny\/(?:\*|[A-Za-z0-9_.-]+)$/);
}

function exactRepository(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    policyError(path);
  }
  return value;
}

function branchNames(value: unknown, path: string): string[] {
  const result = stringList(value, path, /^[A-Za-z0-9._/-]+$/);
  for (const branch of result) {
    if (
      branch.startsWith('/') ||
      branch.endsWith('/') ||
      branch.includes('..') ||
      branch.includes('//')
    ) {
      policyError(path);
    }
  }
  return result;
}

function maintenanceOverrides(value: unknown): MaintenanceRepositoryOverride[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 32) policyError('runtime_maintenance_repository_overrides');

  const overrides = value.map((entry, index) => {
    const path = `runtime_maintenance_repository_overrides_${index}`;
    const raw = exactObject(
      entry,
      ['repository', 'autofix', 'workflowRetries', 'cacheMaxBytes', 'cacheStaleDays'],
      path,
    );
    const result: MaintenanceRepositoryOverride = {
      repository: exactRepository(raw.repository, `${path}_repository`),
    };
    const autofix = optionalBoolean(raw.autofix, `${path}_autofix`);
    const workflowRetries = optionalInteger(raw.workflowRetries, 0, 3, `${path}_workflow_retries`);
    const cacheMaxBytes = optionalInteger(
      raw.cacheMaxBytes,
      MIN_CACHE_MAX_BYTES,
      MAX_CACHE_MAX_BYTES,
      `${path}_cache_max_bytes`,
    );
    const cacheStaleDays = optionalInteger(raw.cacheStaleDays, 1, 365, `${path}_cache_stale_days`);
    if (autofix !== undefined) result.autofix = autofix;
    if (workflowRetries !== undefined) result.workflowRetries = workflowRetries;
    if (cacheMaxBytes !== undefined) result.cacheMaxBytes = cacheMaxBytes;
    if (cacheStaleDays !== undefined) result.cacheStaleDays = cacheStaleDays;
    return result;
  });

  const repositories = overrides.map((entry) => entry.repository);
  if (new Set(repositories).size !== repositories.length) {
    policyError('runtime_maintenance_repository_overrides_duplicate');
  }
  return overrides;
}

export function parseGremlinPolicy(value: unknown): GremlinPolicy {
  const root = exactObject(value, ['version', 'model', 'runtime'], 'root');
  if (root.version !== 1) policyError('version');

  const model = exactObject(
    root.model,
    ['autonomy', 'operatingMode', 'stopConditions', 'preferredActions'],
    'model',
  );
  const runtime = exactObject(
    root.runtime,
    ['repositories', 'maintenance', 'merge', 'release'],
    'runtime',
  );
  const repositories = exactObject(
    runtime.repositories,
    ['include', 'exclude', 'skipArchived'],
    'runtime_repositories',
  );
  const maintenance = exactObject(
    runtime.maintenance,
    [
      'autofix',
      'maxRepositoriesPerRun',
      'maxFixesPerRun',
      'workflowRetries',
      'cacheMaxBytes',
      'cacheStaleDays',
      'repositoryOverrides',
    ],
    'runtime_maintenance',
  );
  const merge = exactObject(
    runtime.merge,
    [
      'enabled',
      'method',
      'requireGreenCi',
      'requireNoActionableReviews',
      'requireExpectedHeadSha',
    ],
    'runtime_merge',
  );
  const release = exactObject(
    runtime.release,
    ['allowedBranches', 'requireExpectedTargetSha'],
    'runtime_release',
  );

  return {
    version: 1,
    model: {
      autonomy: enumString(model.autonomy, ['low', 'medium', 'high'], 'model_autonomy'),
      operatingMode: enumString(
        model.operatingMode,
        ['ask_first', 'plan_then_act', 'act_then_report'],
        'model_operating_mode',
      ),
      stopConditions: stringList(
        model.stopConditions,
        'model_stop_conditions',
        /^[a-z0-9_:-]+$/,
      ),
      preferredActions: stringList(
        model.preferredActions,
        'model_preferred_actions',
        /^[A-Za-z][A-Za-z0-9]+$/,
      ),
    },
    runtime: {
      repositories: {
        include: repositoryPatterns(repositories.include, 'runtime_repositories_include'),
        exclude: repositoryPatterns(repositories.exclude, 'runtime_repositories_exclude'),
        skipArchived: booleanValue(
          repositories.skipArchived,
          'runtime_repositories_skip_archived',
        ),
      },
      maintenance: {
        autofix: booleanValue(maintenance.autofix, 'runtime_maintenance_autofix'),
        maxRepositoriesPerRun: integerValue(
          maintenance.maxRepositoriesPerRun,
          1,
          20,
          'runtime_maintenance_max_repositories_per_run',
        ),
        maxFixesPerRun: integerValue(
          maintenance.maxFixesPerRun,
          1,
          50,
          'runtime_maintenance_max_fixes_per_run',
        ),
        workflowRetries: integerValue(
          maintenance.workflowRetries,
          0,
          3,
          'runtime_maintenance_workflow_retries',
        ),
        cacheMaxBytes: maintenance.cacheMaxBytes === undefined
          ? DEFAULT_CACHE_MAX_BYTES
          : integerValue(
              maintenance.cacheMaxBytes,
              MIN_CACHE_MAX_BYTES,
              MAX_CACHE_MAX_BYTES,
              'runtime_maintenance_cache_max_bytes',
            ),
        cacheStaleDays: maintenance.cacheStaleDays === undefined
          ? DEFAULT_CACHE_STALE_DAYS
          : integerValue(
              maintenance.cacheStaleDays,
              1,
              365,
              'runtime_maintenance_cache_stale_days',
            ),
        repositoryOverrides: maintenanceOverrides(maintenance.repositoryOverrides),
      },
      merge: {
        enabled: booleanValue(merge.enabled, 'runtime_merge_enabled'),
        method: enumString(merge.method, ['merge', 'squash', 'rebase'], 'runtime_merge_method'),
        requireGreenCi: booleanValue(merge.requireGreenCi, 'runtime_merge_require_green_ci'),
        requireNoActionableReviews: booleanValue(
          merge.requireNoActionableReviews,
          'runtime_merge_require_no_actionable_reviews',
        ),
        requireExpectedHeadSha: booleanValue(
          merge.requireExpectedHeadSha,
          'runtime_merge_require_expected_head_sha',
        ),
      },
      release: {
        allowedBranches: branchNames(release.allowedBranches, 'runtime_release_allowed_branches'),
        requireExpectedTargetSha: booleanValue(
          release.requireExpectedTargetSha,
          'runtime_release_require_expected_target_sha',
        ),
      },
    },
  };
}

function repoPath(repository: string): string {
  return repository.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function contentPath(path: string): string {
  return path.split('/').map((part) => encodeURIComponent(part)).join('/');
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

async function readData(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<unknown> {
  const response = await handleGptActions(internalReadRequest(request, path), env, fetcher);
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    throw new PolicyActionError('invalid_action_response', 502);
  }
  if (!isObject(payload)) throw new PolicyActionError('invalid_action_response', 502);
  if (!response.ok || payload.ok !== true) {
    throw new PolicyActionError(
      typeof payload.error === 'string' ? payload.error : 'action_failed',
      response.status,
    );
  }
  return payload.data;
}

async function optionalReadData(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  path: string,
): Promise<unknown | null> {
  try {
    return await readData(request, env, fetcher, path);
  } catch (error) {
    if (error instanceof PolicyActionError && error.status === 404) return null;
    throw error;
  }
}

function decodeGithubFile(value: unknown, maxBytes: number, errorCode: string): string {
  if (!isObject(value) || value.encoding !== 'base64' || typeof value.content !== 'string') {
    throw new PolicyActionError(errorCode, 502);
  }
  try {
    const binary = atob(value.content.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    if (decoded.length > maxBytes) throw new PolicyActionError(`${errorCode}_too_large`, 413);
    return decoded;
  } catch (error) {
    if (error instanceof PolicyActionError) throw error;
    throw new PolicyActionError(errorCode, 502);
  }
}

export async function loadGremlinPolicy(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<LoadedGremlinPolicy> {
  const raw = await readData(
    request,
    env,
    fetcher,
    `/repos/${repoPath(POLICY_REPOSITORY)}/contents/${contentPath(POLICY_PATH)}?ref=${POLICY_REF}`,
  );
  if (!isObject(raw) || typeof raw.sha !== 'string') {
    throw new PolicyActionError('invalid_policy_file_response', 502);
  }
  const text = decodeGithubFile(raw, MAX_POLICY_BYTES, 'invalid_policy_file');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PolicyActionError('invalid_policy_json', 422);
  }
  return {
    policy: parseGremlinPolicy(parsed),
    source: {
      repository: POLICY_REPOSITORY,
      path: POLICY_PATH,
      ref: POLICY_REF,
      sha: raw.sha,
    },
  };
}

function repositoryName(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new PolicyActionError('repository_not_allowed', 403);
  }
  return value;
}

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > 16_000) throw new PolicyActionError('payload_too_large', 413);
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PolicyActionError('invalid_json');
  }
  if (!isObject(parsed)) throw new PolicyActionError('invalid_json_object');
  for (const key of Object.keys(parsed)) {
    if (key !== 'repository') throw new PolicyActionError('invalid_bootstrap_request');
  }
  return parsed;
}

async function repositoryBootstrap(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repository: string,
): Promise<JsonObject> {
  const repo = repoPath(repository);
  const metadata = await readData(request, env, fetcher, `/repos/${repo}`);
  if (!isObject(metadata) || typeof metadata.default_branch !== 'string') {
    throw new PolicyActionError('invalid_repository_response', 502);
  }
  const defaultBranch = metadata.default_branch;
  const agentsRaw = await optionalReadData(
    request,
    env,
    fetcher,
    `/repos/${repo}/contents/AGENTS.md?ref=${encodeURIComponent(defaultBranch)}`,
  );
  let agentsMarkdown: string | null = null;
  if (agentsRaw !== null) {
    agentsMarkdown = decodeGithubFile(agentsRaw, MAX_AGENTS_BYTES, 'invalid_agents_file');
  }
  return {
    name: repository,
    defaultBranch,
    archived: metadata.archived === true,
    private: metadata.private === true,
    htmlUrl: typeof metadata.html_url === 'string' ? metadata.html_url : null,
    instructions: {
      rootAgentsMarkdown: agentsMarkdown,
    },
  };
}

async function operatorBootstrap(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const targetRepository = repositoryName(input.repository);
  const loaded = await loadGremlinPolicy(request, env, fetcher);
  const repository = targetRepository
    ? await repositoryBootstrap(request, env, fetcher, targetRepository)
    : null;

  return json({
    ok: true,
    policySource: loaded.source,
    policy: loaded.policy,
    capabilities: GATEWAY_CAPABILITIES,
    stopConditions: loaded.policy.model.stopConditions,
    repository,
  });
}

export function addPolicyOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[BOOTSTRAP_PATH] = {
    post: {
      operationId: 'getOperatorBootstrap',
      summary: 'Load Gremlin operator policy and repository guidance',
      description:
        'Loads the validated private Gremlin policy and optional repository metadata plus root AGENTS.md. Use at the start of substantial GitHub work.',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                repository: { type: 'string', example: 'trvny/feedseek' },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Validated operator bootstrap context',
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

export async function handlePolicyAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== BOOTSTRAP_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await operatorBootstrap(request, env, fetcher);
  } catch (error) {
    if (error instanceof PolicyActionError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        gptOperatorPolicy: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'operator_policy_internal_error' }, 500);
  }
}
