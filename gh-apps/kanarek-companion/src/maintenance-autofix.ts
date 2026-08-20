import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';
import { handleLifecycleAction } from './lifecycle-actions.ts';
import {
  handleAccountMaintenanceAction,
} from './maintenance-account.ts';
import { handleMaintenanceAction } from './maintenance-actions.ts';
import { handleWorkflowAction } from './workflow-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const ACCOUNT_PATH = '/gpt-actions/github/maintenance/account';
const REPORT_PATH = '/gpt-actions/github/maintenance/report';
const AUTOFIX_PATH = '/gpt-actions/github/maintenance/autofix';
const ARTIFACT_DELETE_PATH = '/gpt-actions/github/maintenance/artifacts/delete';
const CACHE_DELETE_PATH = '/gpt-actions/github/maintenance/caches/delete';
const BRANCH_CLEANUP_PATH = '/gpt-actions/github/pull-requests/cleanup-branch';
const WORKFLOW_CONTROL_PATH = '/gpt-actions/github/workflows/control';
const SHA_RE = /^[0-9a-f]{40}$/i;
const DEFAULT_MAX_ACTIONS = 12;
const MAX_ACTIONS = 20;
const MAX_REPOSITORIES = 8;

type JsonObject = Record<string, unknown>;
type ActionHandler = (
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
) => Promise<Response | null>;

type RepairKind =
  | 'rerun_failed_workflow'
  | 'cleanup_closed_pr_branch'
  | 'delete_dead_branch_cache'
  | 'delete_expired_artifact';

interface RepairPlan extends JsonObject {
  kind: RepairKind;
  repository: string;
}

interface ActionResult {
  ok: boolean;
  status: number;
  payload: JsonObject;
}

class MaintenanceAutofixError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'MaintenanceAutofixError';
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

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function repositoryName(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new MaintenanceAutofixError('repository_not_allowed', 403);
  }
  return value;
}

function repoPath(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function refPath(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function internalRequest(source: Request, pathname: string, body: JsonObject = {}): Request {
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
  if (text.length > 16_000) throw new MaintenanceAutofixError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new MaintenanceAutofixError('invalid_json');
  }
  if (!isObject(value)) throw new MaintenanceAutofixError('invalid_json_object');
  return value;
}

async function responseObject(response: Response): Promise<JsonObject> {
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    throw new MaintenanceAutofixError('invalid_action_response', 502);
  }
  if (!isObject(payload)) throw new MaintenanceAutofixError('invalid_action_response', 502);
  if (!response.ok) {
    throw new MaintenanceAutofixError(
      typeof payload.error === 'string' ? payload.error : 'action_failed',
      response.status,
    );
  }
  return payload;
}

async function invoke(
  handler: ActionHandler,
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  pathname: string,
  body: JsonObject = {},
): Promise<JsonObject> {
  const response = await handler(internalRequest(source, pathname, body), env, fetcher);
  if (!response) throw new MaintenanceAutofixError('action_route_missing', 500);
  return responseObject(response);
}

async function safeInvoke(
  handler: ActionHandler,
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  pathname: string,
  body: JsonObject,
): Promise<ActionResult> {
  try {
    const response = await handler(internalRequest(source, pathname, body), env, fetcher);
    if (!response) {
      return { ok: false, status: 500, payload: { ok: false, error: 'action_route_missing' } };
    }
    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      return { ok: false, status: 502, payload: { ok: false, error: 'invalid_action_response' } };
    }
    if (!isObject(payload)) {
      return { ok: false, status: 502, payload: { ok: false, error: 'invalid_action_response' } };
    }
    return { ok: response.ok && payload.ok !== false, status: response.status, payload };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      payload: {
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 300) : 'action_failed',
      },
    };
  }
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
  return (await responseObject(await readResponse(source, env, fetcher, path))).data;
}

function booleanInput(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new MaintenanceAutofixError(`invalid_${name}`);
  return value;
}

function integerInput(value: unknown, name: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new MaintenanceAutofixError(`invalid_${name}`);
  }
  return value;
}

function repositoryInput(value: unknown): string[] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REPOSITORIES) {
    throw new MaintenanceAutofixError('invalid_repositories');
  }
  const repositories = value.map(repositoryName);
  if (new Set(repositories).size !== repositories.length) {
    throw new MaintenanceAutofixError('duplicate_repository');
  }
  return repositories;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objectArray(parent: unknown, key: string): JsonObject[] {
  if (!isObject(parent)) return [];
  return arrayValue(parent[key]).filter(isObject);
}

export function cacheBranchFromRef(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('refs/heads/')) return null;
  const branch = value.slice('refs/heads/'.length);
  if (
    !branch ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.includes('..') ||
    branch.includes('//') ||
    !/^[A-Za-z0-9._/-]+$/.test(branch)
  ) {
    return null;
  }
  return branch;
}

export function matchingClosedPullRequestNumber(
  values: unknown[],
  repository: string,
  branch: string,
  headSha: string,
): number | null {
  for (const value of values) {
    if (!isObject(value) || value.state !== 'closed' || !Number.isInteger(value.number)) continue;
    const head = isObject(value.head) ? value.head : null;
    const headRepo = head && isObject(head.repo) ? head.repo : null;
    if (
      head?.ref === branch &&
      typeof head.sha === 'string' &&
      head.sha.toLowerCase() === headSha.toLowerCase() &&
      headRepo?.full_name === repository
    ) {
      return value.number as number;
    }
  }
  return null;
}

export function workflowAutofixCandidate(value: unknown): value is JsonObject {
  return (
    isObject(value) &&
    value.status === 'completed' &&
    value.conclusion === 'failure' &&
    value.runAttempt === 1 &&
    typeof value.id === 'number' &&
    Number.isInteger(value.id) &&
    value.id > 0 &&
    typeof value.headSha === 'string' &&
    SHA_RE.test(value.headSha)
  );
}

function planPriority(plan: RepairPlan): number {
  if (plan.kind === 'rerun_failed_workflow') return 0;
  if (plan.kind === 'cleanup_closed_pr_branch') return 1;
  if (plan.kind === 'delete_dead_branch_cache') return 2;
  return 3;
}

function compactPlan(plan: RepairPlan): JsonObject {
  return { ...plan };
}

async function reportForRepository(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repository: string,
): Promise<JsonObject> {
  return invoke(handleMaintenanceAction, request, env, fetcher, REPORT_PATH, { repository });
}

async function branchHeadSha(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repository: string,
  branch: string,
): Promise<string | null> {
  const response = await readResponse(
    request,
    env,
    fetcher,
    `/repos/${repoPath(repository)}/git/ref/heads/${refPath(branch)}`,
  );
  if (response.status === 404) return null;
  const raw = (await responseObject(response)).data;
  const object = isObject(raw) && isObject(raw.object) ? raw.object : null;
  if (!object || typeof object.sha !== 'string' || !SHA_RE.test(object.sha)) {
    throw new MaintenanceAutofixError('invalid_branch_ref_response', 502);
  }
  return object.sha.toLowerCase();
}

async function resolveClosedPullRequest(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repository: string,
  branch: string,
  headSha: string,
): Promise<number | null> {
  const query = new URLSearchParams({
    state: 'closed',
    head: `trvny:${branch}`,
    sort: 'updated',
    direction: 'desc',
    per_page: '10',
  });
  const raw = await readData(
    request,
    env,
    fetcher,
    `/repos/${repoPath(repository)}/pulls?${query.toString()}`,
  );
  return matchingClosedPullRequestNumber(arrayValue(raw), repository, branch, headSha);
}

async function collectPlans(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repository: string,
  report: JsonObject,
  diagnostics: JsonObject[],
): Promise<RepairPlan[]> {
  const plans: RepairPlan[] = [];
  const workflows = isObject(report.workflows) ? report.workflows : {};
  const workflow = objectArray(workflows, 'recentProblemRuns').find(workflowAutofixCandidate);
  if (workflow) {
    const headBranch = stringValue(workflow.headBranch);
    const headSha = stringValue(workflow.headSha);
    if (headBranch && headSha) {
      try {
        const currentHead = await branchHeadSha(request, env, fetcher, repository, headBranch);
        if (currentHead === headSha.toLowerCase()) {
          plans.push({
            kind: 'rerun_failed_workflow',
            repository,
            runId: workflow.id,
            expectedHeadSha: workflow.headSha,
            expectedRunAttempt: workflow.runAttempt,
          });
        }
      } catch (error) {
        diagnostics.push({
          repository,
          area: 'workflow_rerun_planning',
          branch: headBranch,
          error: error instanceof Error ? error.message.slice(0, 200) : 'planning_failed',
        });
      }
    }
  }

  const branches = isObject(report.branches) ? report.branches : {};
  for (const branch of objectArray(branches, 'unattached').slice(0, 8)) {
    const name = stringValue(branch.name);
    const headSha = stringValue(branch.headSha);
    if (!name || !headSha || !SHA_RE.test(headSha) || branch.protected === true) continue;
    try {
      const pullRequestNumber = await resolveClosedPullRequest(
        request,
        env,
        fetcher,
        repository,
        name,
        headSha,
      );
      if (pullRequestNumber) {
        plans.push({
          kind: 'cleanup_closed_pr_branch',
          repository,
          pullRequestNumber,
          branch: name,
          expectedHeadSha: headSha,
        });
      }
    } catch (error) {
      diagnostics.push({
        repository,
        area: 'branch_cleanup_planning',
        branch: name,
        error: error instanceof Error ? error.message.slice(0, 200) : 'planning_failed',
      });
    }
  }

  const cache = isObject(report.cache) ? report.cache : {};
  const cacheBranchState = new Map<string, string | null>();
  for (const item of objectArray(cache, 'items').slice(0, 30)) {
    const id = numberValue(item.id);
    const key = stringValue(item.key);
    const ref = stringValue(item.ref);
    const branch = cacheBranchFromRef(ref);
    if (!id || !key || !ref || !branch) continue;
    let currentHead = cacheBranchState.get(branch);
    if (!cacheBranchState.has(branch)) {
      try {
        currentHead = await branchHeadSha(request, env, fetcher, repository, branch);
        cacheBranchState.set(branch, currentHead);
      } catch (error) {
        diagnostics.push({
          repository,
          area: 'cache_cleanup_planning',
          branch,
          error: error instanceof Error ? error.message.slice(0, 200) : 'planning_failed',
        });
        continue;
      }
    }
    if (currentHead === null) {
      plans.push({
        kind: 'delete_dead_branch_cache',
        repository,
        cacheId: id,
        expectedKey: key,
        expectedRef: ref,
      });
    }
  }

  const artifacts = isObject(report.artifacts) ? report.artifacts : {};
  for (const item of objectArray(artifacts, 'items').slice(0, 30)) {
    const id = numberValue(item.id);
    const name = stringValue(item.name);
    const sizeBytes = numberValue(item.sizeBytes);
    if (!id || !name || sizeBytes === null || item.expired !== true) continue;
    plans.push({
      kind: 'delete_expired_artifact',
      repository,
      artifactId: id,
      expectedName: name,
      expectedSizeBytes: sizeBytes,
    });
  }

  return plans.sort((left, right) => planPriority(left) - planPriority(right));
}

async function executePlan(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  plan: RepairPlan,
): Promise<ActionResult> {
  if (plan.kind === 'rerun_failed_workflow') {
    return safeInvoke(handleWorkflowAction, request, env, fetcher, WORKFLOW_CONTROL_PATH, {
      repository: plan.repository,
      runId: plan.runId,
      expectedHeadSha: plan.expectedHeadSha,
      expectedRunAttempt: plan.expectedRunAttempt,
      action: 'rerun_failed',
    });
  }
  if (plan.kind === 'cleanup_closed_pr_branch') {
    return safeInvoke(handleLifecycleAction, request, env, fetcher, BRANCH_CLEANUP_PATH, {
      repository: plan.repository,
      pullRequestNumber: plan.pullRequestNumber,
      branch: plan.branch,
      expectedHeadSha: plan.expectedHeadSha,
    });
  }
  if (plan.kind === 'delete_dead_branch_cache') {
    return safeInvoke(handleMaintenanceAction, request, env, fetcher, CACHE_DELETE_PATH, {
      repository: plan.repository,
      cacheId: plan.cacheId,
      expectedKey: plan.expectedKey,
      expectedRef: plan.expectedRef,
    });
  }
  return safeInvoke(handleMaintenanceAction, request, env, fetcher, ARTIFACT_DELETE_PATH, {
    repository: plan.repository,
    artifactId: plan.artifactId,
    expectedName: plan.expectedName,
    expectedSizeBytes: plan.expectedSizeBytes,
  });
}

async function selectedRepositories(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  explicit: string[] | null,
): Promise<{ selected: string[]; remaining: string[]; account: JsonObject | null }> {
  if (explicit) return { selected: explicit, remaining: [], account: null };
  const account = await invoke(handleAccountMaintenanceAction, request, env, fetcher, ACCOUNT_PATH);
  const repositories = arrayValue(account.repositories)
    .filter(isObject)
    .map((value) => stringValue(value.name))
    .filter((value): value is string => Boolean(value))
    .map(repositoryName);
  return {
    selected: repositories.slice(0, MAX_REPOSITORIES),
    remaining: repositories.slice(MAX_REPOSITORIES),
    account,
  };
}

async function maintenanceAutofix(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const dryRun = booleanInput(input.dryRun, 'dry_run', false);
  const maxActions = integerInput(input.maxActions, 'max_actions', DEFAULT_MAX_ACTIONS, MAX_ACTIONS);
  const explicitRepositories = repositoryInput(input.repositories);
  const selection = await selectedRepositories(
    request,
    env,
    fetcher,
    explicitRepositories,
  );

  const diagnostics: JsonObject[] = [];
  const plans: RepairPlan[] = [];
  const reports: JsonObject[] = [];
  for (const repository of selection.selected) {
    try {
      const report = await reportForRepository(request, env, fetcher, repository);
      reports.push({
        repository,
        branchesTruncated: isObject(report.branches) && report.branches.truncated === true,
        artifactsTruncated: isObject(report.artifacts) && report.artifacts.truncated === true,
        cacheTruncated: isObject(report.cache) && report.cache.truncated === true,
      });
      plans.push(...await collectPlans(request, env, fetcher, repository, report, diagnostics));
    } catch (error) {
      diagnostics.push({
        repository,
        area: 'repository_report',
        error: error instanceof Error ? error.message.slice(0, 200) : 'report_failed',
      });
    }
  }

  plans.sort((left, right) => planPriority(left) - planPriority(right));
  const selectedPlans = plans.slice(0, maxActions);
  const deferredPlans = plans.slice(maxActions);
  const executed: JsonObject[] = [];

  if (!dryRun) {
    for (const plan of selectedPlans) {
      const result = await executePlan(request, env, fetcher, plan);
      executed.push({
        plan: compactPlan(plan),
        ok: result.ok,
        status: result.status,
        verification: 'guarded_action_response',
        result: result.payload,
      });
    }
  }

  return json({
    ok: true,
    dryRun,
    repositories: {
      processed: selection.selected,
      remaining: selection.remaining,
      detailedReports: reports,
    },
    accountSummary: selection.account && isObject(selection.account.summary)
      ? selection.account.summary
      : null,
    plan: selectedPlans.map(compactPlan),
    deferred: deferredPlans.map(compactPlan),
    executed,
    diagnostics,
    summary: {
      repositoriesProcessed: selection.selected.length,
      planned: selectedPlans.length,
      deferred: deferredPlans.length,
      executed: dryRun ? 0 : executed.length,
      succeeded: dryRun ? 0 : executed.filter((entry) => entry.ok === true).length,
      failed: dryRun ? 0 : executed.filter((entry) => entry.ok !== true).length,
    },
  });
}

export function addMaintenanceAutofixOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[AUTOFIX_PATH] = {
    post: {
      operationId: 'runAccountMaintenanceAutofix',
      summary: 'Plan and execute safe account maintenance fixes',
      description:
        'Plans bounded safe repairs across trvny repositories and executes them through existing guarded actions. Use dryRun to inspect the plan without mutations.',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                repositories: {
                  type: 'array',
                  minItems: 1,
                  maxItems: MAX_REPOSITORIES,
                  items: { type: 'string', example: 'trvny/feedseek' },
                },
                dryRun: { type: 'boolean', default: false },
                maxActions: {
                  type: 'integer',
                  minimum: 1,
                  maximum: MAX_ACTIONS,
                  default: DEFAULT_MAX_ACTIONS,
                },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Maintenance autofix plan and execution report',
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

export async function handleMaintenanceAutofixAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== AUTOFIX_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await maintenanceAutofix(request, env, fetcher);
  } catch (error) {
    if (error instanceof MaintenanceAutofixError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        gptMaintenanceAutofix: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'maintenance_autofix_internal_error' }, 500);
  }
}
