import { handleLifecycleAction } from './lifecycle-actions.ts';
import {
  handleAccountMaintenanceAction,
  summarizeAccountMaintenance,
  type AccountRepositoryMaintenance,
} from './maintenance-account.ts';
import { handleMaintenanceAction } from './maintenance-actions.ts';
import { handleMaintenanceAutofixAction } from './maintenance-autofix.ts';
import {
  loadGremlinPolicy,
  type GremlinPolicy,
  type LoadedGremlinPolicy,
} from './policy-actions.ts';
import { handleWorkflowAction } from './workflow-actions.ts';
import type { GptActionsEnv } from './gpt-actions.ts';

const ACCOUNT_PATH = '/gpt-actions/github/maintenance/account';
const AUTOFIX_PATH = '/gpt-actions/github/maintenance/autofix';
const REPORT_PATH = '/gpt-actions/github/maintenance/report';
const ARTIFACT_DELETE_PATH = '/gpt-actions/github/maintenance/artifacts/delete';
const CACHE_DELETE_PATH = '/gpt-actions/github/maintenance/caches/delete';
const BRANCH_CLEANUP_PATH = '/gpt-actions/github/pull-requests/cleanup-branch';
const WORKFLOW_CONTROL_PATH = '/gpt-actions/github/workflows/control';
const HARD_MAX_REPOSITORIES = 8;
const HARD_MAX_ACTIONS = 20;
const DAY_MS = 24 * 60 * 60 * 1_000;

type JsonObject = Record<string, unknown>;
type ActionHandler = (
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
) => Promise<Response | null>;

interface AutofixInput {
  repositories: string[] | null;
  dryRun: boolean;
  maxActions: number | null;
}

interface ActionResult {
  ok: boolean;
  blocked: boolean;
  status: number;
  payload: JsonObject;
}

export interface EffectiveMaintenancePolicy {
  autofix: boolean;
  workflowRetries: number;
  cacheMaxBytes: number;
  cacheStaleDays: number;
}

class PolicyEnforcementError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'PolicyEnforcementError';
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

function internalRequest(source: Request, pathname: string, body: JsonObject = {}): Request {
  const url = new URL(source.url);
  url.pathname = pathname;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function responseObject(response: Response): Promise<JsonObject> {
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    throw new PolicyEnforcementError('invalid_action_response', 502);
  }
  if (!isObject(payload)) throw new PolicyEnforcementError('invalid_action_response', 502);
  if (!response.ok) {
    throw new PolicyEnforcementError(
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
  if (!response) throw new PolicyEnforcementError('action_route_missing', 500);
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
    if (!response) return failure(500, 'action_route_missing');
    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      return failure(502, 'invalid_action_response');
    }
    if (!isObject(payload)) return failure(502, 'invalid_action_response');
    return {
      ok: response.ok && payload.ok !== false,
      blocked: false,
      status: response.status,
      payload,
    };
  } catch (error) {
    return failure(500, error instanceof Error ? error.message.slice(0, 300) : 'action_failed');
  }
}

function failure(status: number, error: string, blocked = false): ActionResult {
  return { ok: false, blocked, status, payload: { ok: false, error } };
}

function repositoryName(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new PolicyEnforcementError('repository_not_allowed', 403);
  }
  return value;
}

function patternMatches(pattern: string, repository: string): boolean {
  return pattern === 'trvny/*' ? repository.startsWith('trvny/') : pattern === repository;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function epoch(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function repositoryAllowedByPolicy(policy: GremlinPolicy, repository: string): boolean {
  const included = policy.runtime.repositories.include.some((pattern) =>
    patternMatches(pattern, repository),
  );
  const excluded = policy.runtime.repositories.exclude.some((pattern) =>
    patternMatches(pattern, repository),
  );
  return included && !excluded;
}

export function effectiveMaintenancePolicy(
  policy: GremlinPolicy,
  repository: string,
): EffectiveMaintenancePolicy {
  const global = policy.runtime.maintenance;
  const override = global.repositoryOverrides.find((entry) => entry.repository === repository);
  return {
    autofix: global.autofix && override?.autofix !== false,
    workflowRetries: Math.min(global.workflowRetries, override?.workflowRetries ?? global.workflowRetries),
    cacheMaxBytes: override?.cacheMaxBytes ?? global.cacheMaxBytes,
    cacheStaleDays: override?.cacheStaleDays ?? global.cacheStaleDays,
  };
}

function policyMetadata(loaded: LoadedGremlinPolicy): JsonObject {
  return {
    source: loaded.source,
    autonomy: loaded.policy.model.autonomy,
    operatingMode: loaded.policy.model.operatingMode,
  };
}

function withMaintenanceAttention(
  repository: JsonObject,
  policy: GremlinPolicy,
): JsonObject {
  const name = repositoryName(repository.name);
  const effective = effectiveMaintenancePolicy(policy, name);
  const attention = Array.isArray(repository.attention)
    ? repository.attention.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const cache = isObject(repository.cache) ? repository.cache : {};
  const activeBytes = numberValue(cache.activeBytes);
  if (activeBytes !== null && activeBytes >= effective.cacheMaxBytes && !attention.includes('cache_pressure')) {
    attention.push('cache_pressure');
  }
  return {
    ...repository,
    attention,
    maintenancePolicy: effective,
  };
}

export function filterAccountMaintenancePayload(
  payload: JsonObject,
  loaded: LoadedGremlinPolicy,
): JsonObject {
  const repositories = Array.isArray(payload.repositories)
    ? payload.repositories.filter(isObject)
    : [];
  const selected: JsonObject[] = [];
  const excluded: string[] = [];

  for (const repository of repositories) {
    const name = typeof repository.name === 'string' ? repository.name : null;
    if (!name) continue;
    if (
      !repositoryAllowedByPolicy(loaded.policy, name) ||
      (loaded.policy.runtime.repositories.skipArchived && repository.archived === true)
    ) {
      excluded.push(name);
      continue;
    }
    selected.push(withMaintenanceAttention(repository, loaded.policy));
  }

  selected.sort((left, right) => {
    const leftAttention = Array.isArray(left.attention) ? left.attention.length : 0;
    const rightAttention = Array.isArray(right.attention) ? right.attention.length : 0;
    const attention = rightAttention - leftAttention;
    const leftName = typeof left.name === 'string' ? left.name : '';
    const rightName = typeof right.name === 'string' ? right.name : '';
    return attention || leftName.localeCompare(rightName);
  });

  return {
    ...payload,
    scannedCount: selected.length,
    repositories: selected,
    summary: summarizeAccountMaintenance(selected as unknown as AccountRepositoryMaintenance[]),
    policyExcluded: excluded,
    policyApplied: policyMetadata(loaded),
  };
}

export function effectiveAutofixLimits(
  policy: GremlinPolicy,
  requestedMaxActions: number | null,
): { maxRepositories: number; maxActions: number } {
  const maxRepositories = Math.min(
    policy.runtime.maintenance.maxRepositoriesPerRun,
    HARD_MAX_REPOSITORIES,
  );
  const policyMaxActions = Math.min(policy.runtime.maintenance.maxFixesPerRun, HARD_MAX_ACTIONS);
  return {
    maxRepositories,
    maxActions: requestedMaxActions === null
      ? policyMaxActions
      : Math.min(requestedMaxActions, policyMaxActions),
  };
}

async function parseAutofixInput(request: Request): Promise<AutofixInput> {
  const text = await request.clone().text();
  if (text.length > 16_000) throw new PolicyEnforcementError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new PolicyEnforcementError('invalid_json');
  }
  if (!isObject(value)) throw new PolicyEnforcementError('invalid_json_object');
  if (Object.keys(value).some((key) => !['repositories', 'dryRun', 'maxActions'].includes(key))) {
    throw new PolicyEnforcementError('invalid_autofix_request');
  }

  let repositories: string[] | null = null;
  if (value.repositories !== undefined) {
    if (!Array.isArray(value.repositories) || value.repositories.length < 1) {
      throw new PolicyEnforcementError('invalid_repositories');
    }
    repositories = value.repositories.map(repositoryName);
    if (new Set(repositories).size !== repositories.length) {
      throw new PolicyEnforcementError('duplicate_repository');
    }
  }

  const dryRun = value.dryRun === undefined ? false : value.dryRun;
  if (typeof dryRun !== 'boolean') throw new PolicyEnforcementError('invalid_dry_run');

  let maxActions: number | null = null;
  if (value.maxActions !== undefined) {
    if (
      typeof value.maxActions !== 'number' ||
      !Number.isInteger(value.maxActions) ||
      value.maxActions < 1 ||
      value.maxActions > HARD_MAX_ACTIONS
    ) {
      throw new PolicyEnforcementError('invalid_max_actions');
    }
    maxActions = value.maxActions;
  }
  return { repositories, dryRun, maxActions };
}

async function policyAccountPayload(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  loaded: LoadedGremlinPolicy,
): Promise<JsonObject> {
  const raw = await invoke(handleAccountMaintenanceAction, request, env, fetcher, ACCOUNT_PATH);
  return filterAccountMaintenancePayload(raw, loaded);
}

function accountRepositoryNames(payload: JsonObject): string[] {
  if (!Array.isArray(payload.repositories)) return [];
  return payload.repositories
    .filter(isObject)
    .map((repository) => typeof repository.name === 'string' ? repository.name : null)
    .filter((name): name is string => Boolean(name));
}

async function reportForRepository(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repository: string,
): Promise<JsonObject> {
  return invoke(handleMaintenanceAction, request, env, fetcher, REPORT_PATH, { repository });
}

function staleCachePlans(
  repository: string,
  report: JsonObject,
  policy: EffectiveMaintenancePolicy,
  excludedIds: Set<number>,
  now: number,
): JsonObject[] {
  const cache = isObject(report.cache) ? report.cache : {};
  const activeBytes = numberValue(cache.activeBytes);
  if (activeBytes === null || activeBytes < policy.cacheMaxBytes) return [];
  const cutoff = now - policy.cacheStaleDays * DAY_MS;

  return objectArray(cache.items)
    .map((item) => ({ item, lastAccessedEpoch: epoch(item.lastAccessedAt) }))
    .filter(({ item, lastAccessedEpoch }) => {
      const id = numberValue(item.id);
      return (
        id !== null &&
        Number.isInteger(id) &&
        id > 0 &&
        !excludedIds.has(id) &&
        lastAccessedEpoch !== null &&
        lastAccessedEpoch <= cutoff &&
        typeof item.key === 'string' &&
        typeof item.ref === 'string' &&
        typeof item.lastAccessedAt === 'string'
      );
    })
    .sort((left, right) => (left.lastAccessedEpoch ?? 0) - (right.lastAccessedEpoch ?? 0))
    .map(({ item }) => ({
      kind: 'delete_stale_cache',
      repository,
      cacheId: item.id,
      expectedKey: item.key,
      expectedRef: item.ref,
      expectedLastAccessedAt: item.lastAccessedAt,
      policyReason: {
        activeBytes,
        cacheMaxBytes: policy.cacheMaxBytes,
        cacheStaleDays: policy.cacheStaleDays,
      },
    }));
}

async function collectThresholdPlans(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  policy: GremlinPolicy,
  repositories: string[],
  basePlans: JsonObject[],
): Promise<{ plans: JsonObject[]; diagnostics: JsonObject[] }> {
  const excludedIds = new Map<string, Set<number>>();
  for (const plan of basePlans) {
    const repository = stringValue(plan.repository);
    const cacheId = numberValue(plan.cacheId);
    if (!repository || cacheId === null || !Number.isInteger(cacheId)) continue;
    const ids = excludedIds.get(repository) ?? new Set<number>();
    ids.add(cacheId);
    excludedIds.set(repository, ids);
  }

  const plans: JsonObject[] = [];
  const diagnostics: JsonObject[] = [];
  const now = Date.now();
  const reports = await Promise.all(
    repositories.map(async (repository) => {
      try {
        return { repository, report: await reportForRepository(request, env, fetcher, repository) };
      } catch (error) {
        diagnostics.push({
          repository,
          area: 'cache_threshold_planning',
          error: error instanceof Error ? error.message.slice(0, 200) : 'planning_failed',
        });
        return null;
      }
    }),
  );

  for (const entry of reports) {
    if (!entry) continue;
    plans.push(
      ...staleCachePlans(
        entry.repository,
        entry.report,
        effectiveMaintenancePolicy(policy, entry.repository),
        excludedIds.get(entry.repository) ?? new Set<number>(),
        now,
      ),
    );
  }
  return { plans, diagnostics };
}

async function verifyStaleCachePlan(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  policy: GremlinPolicy,
  plan: JsonObject,
): Promise<ActionResult | null> {
  const repository = repositoryName(plan.repository);
  const effective = effectiveMaintenancePolicy(policy, repository);
  const report = await reportForRepository(request, env, fetcher, repository);
  const cache = isObject(report.cache) ? report.cache : {};
  const activeBytes = numberValue(cache.activeBytes);
  if (activeBytes === null || activeBytes < effective.cacheMaxBytes) {
    return failure(409, 'cache_pressure_cleared', true);
  }
  const cacheId = numberValue(plan.cacheId);
  const expectedKey = stringValue(plan.expectedKey);
  const expectedRef = stringValue(plan.expectedRef);
  const expectedLastAccessedAt = stringValue(plan.expectedLastAccessedAt);
  if (cacheId === null || !expectedKey || !expectedRef || !expectedLastAccessedAt) {
    return failure(422, 'invalid_stale_cache_plan', true);
  }
  const current = objectArray(cache.items).find((item) => item.id === cacheId);
  if (
    !current ||
    current.key !== expectedKey ||
    current.ref !== expectedRef ||
    current.lastAccessedAt !== expectedLastAccessedAt
  ) {
    return failure(409, 'stale_cache_snapshot_changed', true);
  }
  const lastAccessedAt = epoch(current.lastAccessedAt);
  const cutoff = Date.now() - effective.cacheStaleDays * DAY_MS;
  if (lastAccessedAt === null || lastAccessedAt > cutoff) {
    return failure(409, 'stale_cache_recently_accessed', true);
  }
  return null;
}

async function executePlan(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  policy: GremlinPolicy,
  plan: JsonObject,
): Promise<ActionResult> {
  const repository = repositoryName(plan.repository);
  const kind = typeof plan.kind === 'string' ? plan.kind : '';
  const effective = effectiveMaintenancePolicy(policy, repository);

  if (!effective.autofix) {
    return failure(403, 'policy_blocks_repository_autofix', true);
  }
  if (kind === 'rerun_failed_workflow') {
    if (effective.workflowRetries < 1) {
      return failure(403, 'policy_blocks_workflow_retry', true);
    }
    return safeInvoke(handleWorkflowAction, request, env, fetcher, WORKFLOW_CONTROL_PATH, {
      repository,
      runId: plan.runId,
      expectedHeadSha: plan.expectedHeadSha,
      expectedRunAttempt: plan.expectedRunAttempt,
      action: 'rerun_failed',
    });
  }
  if (kind === 'cleanup_closed_pr_branch') {
    return safeInvoke(handleLifecycleAction, request, env, fetcher, BRANCH_CLEANUP_PATH, {
      repository,
      pullRequestNumber: plan.pullRequestNumber,
      branch: plan.branch,
      expectedHeadSha: plan.expectedHeadSha,
    });
  }
  if (kind === 'delete_dead_branch_cache') {
    return safeInvoke(handleMaintenanceAction, request, env, fetcher, CACHE_DELETE_PATH, {
      repository,
      cacheId: plan.cacheId,
      expectedKey: plan.expectedKey,
      expectedRef: plan.expectedRef,
    });
  }
  if (kind === 'delete_stale_cache') {
    const blocker = await verifyStaleCachePlan(request, env, fetcher, policy, plan);
    if (blocker) return blocker;
    return safeInvoke(handleMaintenanceAction, request, env, fetcher, CACHE_DELETE_PATH, {
      repository,
      cacheId: plan.cacheId,
      expectedKey: plan.expectedKey,
      expectedRef: plan.expectedRef,
      expectedLastAccessedAt: plan.expectedLastAccessedAt,
    });
  }
  if (kind === 'delete_expired_artifact') {
    return safeInvoke(handleMaintenanceAction, request, env, fetcher, ARTIFACT_DELETE_PATH, {
      repository,
      artifactId: plan.artifactId,
      expectedName: plan.expectedName,
      expectedSizeBytes: plan.expectedSizeBytes,
    });
  }
  return failure(422, 'policy_unknown_repair_kind', true);
}

function effectiveMaintenanceByRepository(policy: GremlinPolicy, repositories: string[]): JsonObject {
  return Object.fromEntries(
    repositories.map((repository) => [repository, effectiveMaintenancePolicy(policy, repository)]),
  );
}

function noWorkResponse(
  input: AutofixInput,
  loaded: LoadedGremlinPolicy,
  account: JsonObject,
  remaining: string[],
  limits: { maxRepositories: number; maxActions: number },
): Response {
  return json({
    ok: true,
    dryRun: input.dryRun,
    accountSummary: isObject(account.summary) ? account.summary : null,
    repositories: { processed: [], remaining, detailedReports: [] },
    plan: [],
    deferred: [],
    executed: [],
    diagnostics: [],
    policyApplied: {
      ...policyMetadata(loaded),
      limits,
      maintenance: loaded.policy.runtime.maintenance,
    },
    summary: {
      repositoriesProcessed: 0,
      planned: 0,
      deferred: 0,
      executed: 0,
      succeeded: 0,
      failed: 0,
      blocked: 0,
    },
  });
}

async function policyAccountMaintenance(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const loaded = await loadGremlinPolicy(request, env, fetcher);
  return json(await policyAccountPayload(request, env, fetcher, loaded));
}

async function policyMaintenanceAutofix(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const [input, loaded] = await Promise.all([
    parseAutofixInput(request),
    loadGremlinPolicy(request, env, fetcher),
  ]);
  const limits = effectiveAutofixLimits(loaded.policy, input.maxActions);
  const account = await policyAccountPayload(request, env, fetcher, loaded);
  const allowed = accountRepositoryNames(account);
  const allowedSet = new Set(allowed);

  let selected: string[];
  let remaining: string[];
  if (input.repositories) {
    const denied = input.repositories.filter((repository) => !allowedSet.has(repository));
    if (denied.length) {
      return json(
        {
          ok: false,
          error: 'repository_not_allowed_by_policy',
          repositories: denied,
          policyApplied: policyMetadata(loaded),
        },
        403,
      );
    }
    selected = input.repositories.slice(0, limits.maxRepositories);
    remaining = input.repositories.slice(limits.maxRepositories);
  } else {
    selected = allowed.slice(0, limits.maxRepositories);
    remaining = allowed.slice(limits.maxRepositories);
  }

  if (!selected.length) return noWorkResponse(input, loaded, account, remaining, limits);
  if (!input.dryRun && !loaded.policy.runtime.maintenance.autofix) {
    return json(
      {
        ok: false,
        error: 'maintenance_autofix_disabled_by_policy',
        policyApplied: policyMetadata(loaded),
      },
      403,
    );
  }

  const planner = await invoke(
    handleMaintenanceAutofixAction,
    request,
    env,
    fetcher,
    AUTOFIX_PATH,
    { repositories: selected, dryRun: true, maxActions: limits.maxActions },
  );
  const basePlans = Array.isArray(planner.plan) ? planner.plan.filter(isObject) : [];
  const threshold = await collectThresholdPlans(
    request,
    env,
    fetcher,
    loaded.policy,
    selected,
    basePlans,
  );
  const combinedPlans = [...basePlans, ...threshold.plans];
  const plans = combinedPlans.slice(0, limits.maxActions);
  const extraDeferred = combinedPlans.slice(limits.maxActions);
  const plannerDeferred = Array.isArray(planner.deferred) ? planner.deferred : [];
  const diagnostics = [
    ...(Array.isArray(planner.diagnostics) ? planner.diagnostics : []),
    ...threshold.diagnostics,
  ];

  const common = {
    ...planner,
    plan: plans,
    deferred: [...plannerDeferred, ...extraDeferred],
    diagnostics,
    accountSummary: isObject(account.summary) ? account.summary : null,
    repositories: {
      ...(isObject(planner.repositories) ? planner.repositories : {}),
      processed: selected,
      remaining,
    },
    policyApplied: {
      ...policyMetadata(loaded),
      limits,
      maintenance: loaded.policy.runtime.maintenance,
      effectiveMaintenance: effectiveMaintenanceByRepository(loaded.policy, selected),
    },
  };

  if (input.dryRun) return json({ ...common, dryRun: true });

  const executed: JsonObject[] = [];
  for (const plan of plans) {
    const result = await executePlan(request, env, fetcher, loaded.policy, plan);
    executed.push({
      plan,
      ok: result.ok,
      blocked: result.blocked,
      status: result.status,
      verification: 'guarded_action_response',
      result: result.payload,
    });
  }

  const blocked = executed.filter((entry) => entry.blocked === true).length;
  const succeeded = executed.filter((entry) => entry.ok === true).length;
  const failed = executed.length - succeeded - blocked;
  return json({
    ...common,
    dryRun: false,
    executed,
    summary: {
      repositoriesProcessed: selected.length,
      planned: plans.length,
      deferred: [...plannerDeferred, ...extraDeferred].length,
      executed: executed.length,
      succeeded,
      failed,
      blocked,
    },
  });
}

export async function handlePolicyEnforcementAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== ACCOUNT_PATH && pathname !== AUTOFIX_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return pathname === ACCOUNT_PATH
      ? await policyAccountMaintenance(request, env, fetcher)
      : await policyMaintenanceAutofix(request, env, fetcher);
  } catch (error) {
    if (error instanceof PolicyEnforcementError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        gptPolicyEnforcement: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'policy_enforcement_internal_error' }, 500);
  }
}
