import { handleOperatorAction } from './operator-actions.ts';
import { handlePolicyEnforcementAction } from './policy-enforcement.ts';
import type { GptActionsEnv } from './gpt-actions.ts';

const AUTOPILOT_PATH = '/gpt-actions/operator/autopilot';
const ACCOUNT_PATH = '/gpt-actions/github/maintenance/account';
const AUTOFIX_PATH = '/gpt-actions/github/maintenance/autofix';
const INSPECT_PR_PATH = '/gpt-actions/github/pull-requests/inspect';
const HARD_MAX_REPOSITORIES = 8;
const HARD_MAX_TASKS = 12;
const DEFAULT_MAX_TASKS = 8;
const INSPECTION_CONCURRENCY = 3;

type JsonObject = Record<string, unknown>;
type ActionHandler = (
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
) => Promise<Response | null>;

interface AutopilotInput {
  repositories: string[] | null;
  dryRun: boolean;
  maxTasks: number;
}

interface AutopilotTask extends JsonObject {
  priority: number;
  kind: string;
  repository: string;
}

class AutopilotError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'AutopilotError';
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

async function inputObject(request: Request): Promise<AutopilotInput> {
  const text = await request.clone().text();
  if (text.length > 16_000) throw new AutopilotError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new AutopilotError('invalid_json');
  }
  if (!isObject(value)) throw new AutopilotError('invalid_json_object');
  if (Object.keys(value).some((key) => !['repositories', 'dryRun', 'maxTasks'].includes(key))) {
    throw new AutopilotError('invalid_autopilot_request');
  }

  let repositories: string[] | null = null;
  if (value.repositories !== undefined) {
    if (
      !Array.isArray(value.repositories) ||
      value.repositories.length < 1 ||
      value.repositories.length > HARD_MAX_REPOSITORIES
    ) {
      throw new AutopilotError('invalid_repositories');
    }
    repositories = value.repositories.map((entry) => {
      if (typeof entry !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(entry)) {
        throw new AutopilotError('repository_not_allowed', 403);
      }
      return entry;
    });
    if (new Set(repositories).size !== repositories.length) {
      throw new AutopilotError('duplicate_repository');
    }
  }

  const dryRun = value.dryRun === undefined ? false : value.dryRun;
  if (typeof dryRun !== 'boolean') throw new AutopilotError('invalid_dry_run');

  const maxTasks = value.maxTasks === undefined ? DEFAULT_MAX_TASKS : value.maxTasks;
  if (
    typeof maxTasks !== 'number' ||
    !Number.isInteger(maxTasks) ||
    maxTasks < 1 ||
    maxTasks > HARD_MAX_TASKS
  ) {
    throw new AutopilotError('invalid_max_tasks');
  }

  return { repositories, dryRun, maxTasks };
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
  if (!response) throw new AutopilotError('action_route_missing', 500);
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    throw new AutopilotError('invalid_action_response', 502);
  }
  if (!isObject(payload)) throw new AutopilotError('invalid_action_response', 502);
  if (!response.ok || payload.ok === false) {
    throw new AutopilotError(
      typeof payload.error === 'string' ? payload.error : 'action_failed',
      response.status,
    );
  }
  return payload;
}

function objectArray(value: unknown, key: string): JsonObject[] {
  if (!isObject(value) || !Array.isArray(value[key])) return [];
  return value[key].filter(isObject);
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function selectedRepositories(payload: JsonObject, explicit: string[] | null): JsonObject[] {
  const repositories = objectArray(payload, 'repositories');
  if (!explicit) return repositories;
  const allowed = new Set(explicit);
  return repositories.filter((repository) => {
    const name = stringValue(repository.name);
    return Boolean(name && allowed.has(name));
  });
}

function selectedSummary(repositories: JsonObject[]): JsonObject {
  return repositories.reduce<JsonObject>(
    (summary, repository) => {
      const pulls = isObject(repository.pullRequests) ? repository.pullRequests : {};
      const branches = isObject(repository.branches) ? repository.branches : {};
      const workflows = isObject(repository.workflows) ? repository.workflows : {};
      const cache = isObject(repository.cache) ? repository.cache : {};
      const attention = Array.isArray(repository.attention) ? repository.attention : [];
      const errors = Array.isArray(repository.errors) ? repository.errors : [];
      summary.openPullRequests = Number(summary.openPullRequests) + (numberValue(pulls.openCount) ?? 0);
      summary.unattachedBranches = Number(summary.unattachedBranches) + (numberValue(branches.unattachedCount) ?? 0);
      summary.problemWorkflowRuns = Number(summary.problemWorkflowRuns) + (numberValue(workflows.problemCount) ?? 0);
      summary.pendingWorkflowRuns = Number(summary.pendingWorkflowRuns) + (numberValue(workflows.pendingCount) ?? 0);
      summary.activeCacheBytes = Number(summary.activeCacheBytes) + (numberValue(cache.activeBytes) ?? 0);
      summary.repositoriesWithAttention = Number(summary.repositoriesWithAttention) + Number(attention.length > 0);
      summary.partialRepositories = Number(summary.partialRepositories) + Number(errors.length > 0);
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

function compactAccount(payload: JsonObject, explicit: string[] | null): JsonObject {
  const repositories = selectedRepositories(payload, explicit);
  return {
    summary: explicit
      ? selectedSummary(repositories)
      : isObject(payload.summary)
        ? payload.summary
        : selectedSummary(repositories),
    repositoryCount: numberValue(payload.repositoryCount),
    scannedCount: repositories.length,
    policyExcluded: Array.isArray(payload.policyExcluded) ? payload.policyExcluded : [],
    repositories: repositories.map((repository) => ({
      name: stringValue(repository.name),
      attention: Array.isArray(repository.attention) ? repository.attention : [],
      openPullRequests: isObject(repository.pullRequests)
        ? numberValue(repository.pullRequests.openCount)
        : null,
      unattachedBranches: isObject(repository.branches)
        ? numberValue(repository.branches.unattachedCount)
        : null,
      problemWorkflowRuns: isObject(repository.workflows)
        ? numberValue(repository.workflows.problemCount)
        : null,
      pendingWorkflowRuns: isObject(repository.workflows)
        ? numberValue(repository.workflows.pendingCount)
        : null,
      errors: Array.isArray(repository.errors) ? repository.errors.length : 0,
    })),
  };
}

function summaryNumber(payload: JsonObject, key: string): number {
  if (!isObject(payload.summary)) return 0;
  return numberValue(payload.summary[key]) ?? 0;
}

export function maintenanceDelta(before: JsonObject, after: JsonObject): JsonObject {
  const keys = [
    'unattachedBranches',
    'problemWorkflowRuns',
    'pendingWorkflowRuns',
    'activeCacheBytes',
    'repositoriesWithAttention',
    'partialRepositories',
  ];
  const delta: JsonObject = {};
  for (const key of keys) {
    delta[key] = summaryNumber(after, key) - summaryNumber(before, key);
  }
  return delta;
}

function workflowTasks(repository: JsonObject): AutopilotTask[] {
  const name = stringValue(repository.name);
  if (!name || !isObject(repository.workflows)) return [];
  return objectArray(repository.workflows, 'recentProblemRuns').map((run) => ({
    priority: 10,
    kind: 'workflow_failure',
    repository: name,
    runId: numberValue(run.id),
    workflow: stringValue(run.name),
    headBranch: stringValue(run.headBranch),
    headSha: stringValue(run.headSha),
    nextAction: 'diagnoseWorkflowRun',
  }));
}

function repositoryTasks(repository: JsonObject): AutopilotTask[] {
  const name = stringValue(repository.name);
  if (!name) return [];
  const tasks: AutopilotTask[] = [];
  tasks.push(...workflowTasks(repository));

  const branches = isObject(repository.branches) ? repository.branches : {};
  const unattachedCount = numberValue(branches.unattachedCount) ?? 0;
  if (unattachedCount > 0) {
    tasks.push({
      priority: 40,
      kind: 'unattached_branches_remaining',
      repository: name,
      count: unattachedCount,
      sample: Array.isArray(branches.unattached) ? branches.unattached.slice(0, 5) : [],
      nextAction: 'getRepositoryMaintenance',
    });
  }

  const errors = Array.isArray(repository.errors) ? repository.errors : [];
  if (errors.length > 0) {
    tasks.push({
      priority: 50,
      kind: 'partial_repository_data',
      repository: name,
      errors: errors.slice(0, 5),
      nextAction: 'getRepositoryMaintenance',
    });
  }

  if (isObject(repository.workflows)) {
    for (const run of objectArray(repository.workflows, 'pendingRuns')) {
      tasks.push({
        priority: 60,
        kind: 'workflow_pending',
        repository: name,
        runId: numberValue(run.id),
        workflow: stringValue(run.name),
        headBranch: stringValue(run.headBranch),
        headSha: stringValue(run.headSha),
        nextAction: null,
        waitForCompletion: true,
      });
    }
  }

  return tasks;
}

interface PullRequestCandidate {
  repository: string;
  number: number;
  headSha: string;
  title: string | null;
  draft: boolean;
}

function pullRequestCandidates(repositories: JsonObject[]): PullRequestCandidate[] {
  const candidates: PullRequestCandidate[] = [];
  for (const repository of repositories) {
    const name = stringValue(repository.name);
    if (!name || !isObject(repository.pullRequests)) continue;
    for (const pullRequest of objectArray(repository.pullRequests, 'items')) {
      const number = numberValue(pullRequest.number);
      const headSha = stringValue(pullRequest.headSha);
      if (!number || !headSha) continue;
      candidates.push({
        repository: name,
        number,
        headSha,
        title: stringValue(pullRequest.title),
        draft: pullRequest.draft === true,
      });
    }
  }
  return candidates;
}

export function classifyPullRequestSnapshot(
  candidate: PullRequestCandidate,
  snapshotValue: unknown,
): AutopilotTask {
  const snapshot = isObject(snapshotValue) ? snapshotValue : {};
  const ciState = stringValue(snapshot.ciState) ?? 'unknown';
  const unresolvedThreads = numberValue(snapshot.unresolvedThreads) ?? 0;
  const activeChangeRequests = numberValue(snapshot.activeChangeRequests) ?? 0;
  const mergeable = typeof snapshot.mergeable === 'boolean' ? snapshot.mergeable : null;
  const state = stringValue(snapshot.state) ?? 'unknown';
  const draft = candidate.draft || snapshot.draft === true;

  if (draft) {
    return {
      priority: 35,
      kind: 'pull_request_draft',
      repository: candidate.repository,
      pullRequestNumber: candidate.number,
      headSha: candidate.headSha,
      title: candidate.title,
      nextAction: 'inspectPullRequest',
    };
  }
  if (ciState === 'failure') {
    return {
      priority: 15,
      kind: 'pull_request_ci_failed',
      repository: candidate.repository,
      pullRequestNumber: candidate.number,
      headSha: candidate.headSha,
      title: candidate.title,
      nextAction: null,
      coveredByWorkflowFailureTask: true,
    };
  }
  if (ciState === 'pending') {
    return {
      priority: 55,
      kind: 'pull_request_ci_pending',
      repository: candidate.repository,
      pullRequestNumber: candidate.number,
      headSha: candidate.headSha,
      title: candidate.title,
      nextAction: null,
      waitForCompletion: true,
    };
  }
  if (unresolvedThreads > 0 || activeChangeRequests > 0) {
    return {
      priority: 20,
      kind: 'pull_request_review_blocked',
      repository: candidate.repository,
      pullRequestNumber: candidate.number,
      headSha: candidate.headSha,
      title: candidate.title,
      unresolvedThreads,
      activeChangeRequests,
      nextAction: 'inspectPullRequest',
    };
  }
  if (state !== 'open' || mergeable !== true) {
    return {
      priority: 30,
      kind: mergeable === null ? 'pull_request_mergeability_unknown' : 'pull_request_not_mergeable',
      repository: candidate.repository,
      pullRequestNumber: candidate.number,
      headSha: candidate.headSha,
      title: candidate.title,
      state,
      mergeable,
      nextAction: 'inspectPullRequest',
    };
  }
  return {
    priority: 25,
    kind: 'pull_request_ready_candidate',
    repository: candidate.repository,
    pullRequestNumber: candidate.number,
    headSha: candidate.headSha,
    title: candidate.title,
    ciState,
    semanticReviewRequired: true,
    nextAction: 'finalizePullRequest',
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

async function inspectPullRequests(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repositories: JsonObject[],
  limit: number,
): Promise<{ tasks: AutopilotTask[]; diagnostics: JsonObject[]; truncated: boolean }> {
  const candidates = pullRequestCandidates(repositories);
  const selected = candidates.slice(0, limit);
  const diagnostics: JsonObject[] = [];
  const tasks = await mapLimit(selected, INSPECTION_CONCURRENCY, async (candidate) => {
    try {
      const payload = await invoke(
        handleOperatorAction,
        request,
        env,
        fetcher,
        INSPECT_PR_PATH,
        {
          repository: candidate.repository,
          pullRequestNumber: candidate.number,
        },
      );
      const data = isObject(payload.data) ? payload.data : {};
      return classifyPullRequestSnapshot(candidate, data.finalizeSnapshot);
    } catch (error) {
      diagnostics.push({
        repository: candidate.repository,
        pullRequestNumber: candidate.number,
        area: 'pull_request_inspection',
        error: error instanceof Error ? error.message.slice(0, 200) : 'inspection_failed',
      });
      return {
        priority: 45,
        kind: 'pull_request_inspection_failed',
        repository: candidate.repository,
        pullRequestNumber: candidate.number,
        headSha: candidate.headSha,
        title: candidate.title,
        nextAction: 'inspectPullRequest',
      } satisfies AutopilotTask;
    }
  });
  return { tasks, diagnostics, truncated: candidates.length > selected.length };
}

function compactAutofix(payload: JsonObject | null): JsonObject | null {
  if (!payload) return null;
  return {
    dryRun: payload.dryRun === true,
    summary: isObject(payload.summary) ? payload.summary : null,
    plan: Array.isArray(payload.plan) ? payload.plan : [],
    executed: Array.isArray(payload.executed) ? payload.executed : [],
    diagnostics: Array.isArray(payload.diagnostics) ? payload.diagnostics : [],
    policyApplied: isObject(payload.policyApplied) ? payload.policyApplied : null,
  };
}

async function operatorAutopilot(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const initial = await invoke(
    handlePolicyEnforcementAction,
    request,
    env,
    fetcher,
    ACCOUNT_PATH,
  );
  const initialRepositories = selectedRepositories(initial, input.repositories);
  if (input.repositories) {
    const available = new Set(
      initialRepositories
        .map((repository) => stringValue(repository.name))
        .filter((name): name is string => Boolean(name)),
    );
    if (input.repositories.some((repository) => !available.has(repository))) {
      throw new AutopilotError('repository_not_available_in_policy_scope', 403);
    }
  }
  const selectedNames = initialRepositories
    .map((repository) => stringValue(repository.name))
    .filter((name): name is string => Boolean(name));

  let maintenance: JsonObject | null = null;
  if (selectedNames.length > 0) {
    maintenance = await invoke(
      handlePolicyEnforcementAction,
      request,
      env,
      fetcher,
      AUTOFIX_PATH,
      {
        repositories: selectedNames,
        dryRun: input.dryRun,
      },
    );
  }

  const verified = input.dryRun
    ? initial
    : await invoke(handlePolicyEnforcementAction, request, env, fetcher, ACCOUNT_PATH);
  const verifiedRepositories = selectedRepositories(verified, input.repositories);
  const prInspection = await inspectPullRequests(
    request,
    env,
    fetcher,
    verifiedRepositories,
    input.maxTasks,
  );

  const tasks = [
    ...verifiedRepositories.flatMap(repositoryTasks),
    ...prInspection.tasks,
  ].sort(
    (left, right) => left.priority - right.priority || left.repository.localeCompare(right.repository),
  );
  const selectedTasks = tasks.slice(0, input.maxTasks);
  const deferredTasks = tasks.slice(input.maxTasks);
  const actionable = selectedTasks.filter((task) => task.waitForCompletion !== true);
  const complete = tasks.length === 0;
  const initialCompact = compactAccount(initial, input.repositories);
  const verifiedCompact = compactAccount(verified, input.repositories);

  return json({
    ok: true,
    dryRun: input.dryRun,
    cycle: {
      initial: initialCompact,
      maintenance: compactAutofix(maintenance),
      verified: verifiedCompact,
      delta: maintenanceDelta(initialCompact, verifiedCompact),
    },
    tasks: selectedTasks,
    deferredTaskCount: deferredTasks.length,
    diagnostics: prInspection.diagnostics,
    pullRequestInspectionTruncated: prInspection.truncated,
    continuation: {
      complete,
      continueAutomatically: !complete && actionable.length > 0,
      waitingOnly: !complete && actionable.length === 0,
      instruction: complete
        ? 'No remaining operator attention detected in the verified scope.'
        : actionable.length > 0
          ? 'Continue through actionable tasks in priority order using nextAction. Do not ask for routine confirmation; stop only on runtime policy stop conditions or a genuinely material decision.'
          : 'Only pending asynchronous work remains. Re-run the autopilot after CI or workflow state changes.',
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

export function addAutopilotOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[AUTOPILOT_PATH] = {
    post: {
      operationId: 'runOperatorAutopilot',
      summary: 'Run the guarded Gremlin operator loop',
      description:
        'Scans policy-allowed repositories, plans or executes safe maintenance, verifies the account again, inspects bounded open PRs and returns prioritized continuation tasks for autonomous follow-through.',
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
                  maxItems: HARD_MAX_REPOSITORIES,
                  items: { type: 'string', example: 'trvny/feedseek' },
                },
                dryRun: { type: 'boolean', default: false },
                maxTasks: {
                  type: 'integer',
                  minimum: 1,
                  maximum: HARD_MAX_TASKS,
                  default: DEFAULT_MAX_TASKS,
                },
              },
            },
          },
        },
      },
      responses: objectResponse('Verified autopilot cycle and continuation queue'),
    },
  };
}

export async function handleAutopilotAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== AUTOPILOT_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await operatorAutopilot(request, env, fetcher);
  } catch (error) {
    if (error instanceof AutopilotError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        gptAutopilot: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'operator_autopilot_internal_error' }, 500);
  }
}
