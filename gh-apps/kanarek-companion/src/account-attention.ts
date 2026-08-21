export const ACCOUNT_ATTENTION_PATH = '/gpt-actions/operator/attention';

const MAINTENANCE_PATH = '/gpt-actions/github/maintenance/account';
const INSPECT_PR_PATH = '/gpt-actions/github/pull-requests/inspect';
const READ_PATH = '/gpt-actions/github/read';
const DEFAULT_MAX_REPOSITORIES = 12;
const DEFAULT_MAX_PULL_REQUESTS = 6;
const DEFAULT_ISSUES_PER_REPOSITORY = 5;
const HARD_MAX_REPOSITORIES = 20;
const HARD_MAX_PULL_REQUESTS = 10;
const HARD_ISSUES_PER_REPOSITORY = 10;
const STALE_ISSUE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1_000;

type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;

type Input = {
  maxRepositories: number;
  maxPullRequests: number;
  issuesPerRepository: number;
};

type PullRequestRef = {
  repository: string;
  number: number;
  title: string | null;
  draft: boolean;
  updatedAt: string | null;
  htmlUrl: string | null;
};

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

function integerOption(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error('invalid_attention_limits');
  }
  return value;
}

async function inputObject(request: Request): Promise<Input> {
  const text = await request.clone().text();
  if (text.length > 8_000) throw new Error('payload_too_large');
  let value: unknown = {};
  if (text.trim()) value = JSON.parse(text);
  if (!isObject(value)) throw new Error('invalid_json_object');
  if (Object.keys(value).some((key) => !['maxRepositories', 'maxPullRequests', 'issuesPerRepository'].includes(key))) {
    throw new Error('invalid_attention_request');
  }
  return {
    maxRepositories: integerOption(value.maxRepositories, DEFAULT_MAX_REPOSITORIES, HARD_MAX_REPOSITORIES),
    maxPullRequests: integerOption(value.maxPullRequests, DEFAULT_MAX_PULL_REQUESTS, HARD_MAX_PULL_REQUESTS),
    issuesPerRepository: integerOption(
      value.issuesPerRepository,
      DEFAULT_ISSUES_PER_REPOSITORY,
      HARD_ISSUES_PER_REPOSITORY,
    ),
  };
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

async function responseObject(response: Response): Promise<JsonObject | null> {
  try {
    const value: unknown = await response.clone().json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

function repoPath(repository: string): string {
  return repository.split('/').map(encodeURIComponent).join('/');
}

async function readData(source: Request, invoke: Invoke, path: string): Promise<unknown> {
  const response = await invoke(internalRequest(source, READ_PATH, { path }));
  const payload = await responseObject(response);
  if (!response.ok || payload?.ok !== true) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : `read_${response.status}`);
  }
  return payload.data;
}

async function mapLimit<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      output[index] = await mapper(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return output;
}

function repositoriesFromMaintenance(payload: JsonObject): JsonObject[] {
  return Array.isArray(payload.repositories) ? payload.repositories.filter(isObject) : [];
}

function pullRequestRefs(repositories: JsonObject[]): PullRequestRef[] {
  const refs: PullRequestRef[] = [];
  for (const repository of repositories) {
    const name = stringValue(repository.name);
    const pulls = isObject(repository.pullRequests) && Array.isArray(repository.pullRequests.items)
      ? repository.pullRequests.items.filter(isObject)
      : [];
    if (!name) continue;
    for (const pull of pulls) {
      const number = numberValue(pull.number);
      if (number === null || !Number.isInteger(number) || number < 1) continue;
      refs.push({
        repository: name,
        number,
        title: stringValue(pull.title),
        draft: pull.draft === true,
        updatedAt: stringValue(pull.updatedAt),
        htmlUrl: stringValue(pull.htmlUrl),
      });
    }
  }
  const unique = new Map<string, PullRequestRef>();
  for (const ref of refs) unique.set(`${ref.repository}#${ref.number}`, ref);
  return [...unique.values()].sort((left, right) => {
    const draft = Number(left.draft) - Number(right.draft);
    return draft || (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '');
  });
}

function prReasons(snapshot: JsonObject): string[] {
  const reasons: string[] = [];
  const ciState = stringValue(snapshot.ciState);
  const unresolved = numberValue(snapshot.unresolvedThreads) ?? 0;
  const changes = numberValue(snapshot.activeChangeRequests) ?? 0;
  const state = stringValue(snapshot.state);
  const mergeable = typeof snapshot.mergeable === 'boolean' ? snapshot.mergeable : null;

  if (snapshot.draft === true) reasons.push('draft');
  if (ciState === 'failure') reasons.push('ci_failed');
  else if (ciState === 'pending') reasons.push('ci_pending');
  if (unresolved > 0) reasons.push('review_threads');
  if (changes > 0) reasons.push('changes_requested');
  if (mergeable === false) reasons.push('not_mergeable');
  else if (mergeable === null) reasons.push('mergeability_unknown');
  if (
    state === 'open' &&
    snapshot.draft !== true &&
    ciState !== 'failure' &&
    ciState !== 'pending' &&
    unresolved === 0 &&
    changes === 0 &&
    mergeable === true
  ) {
    reasons.push('merge_candidate');
  }
  return reasons;
}

function prScore(reasons: string[]): number {
  const weights: Record<string, number> = {
    ci_failed: 100,
    changes_requested: 95,
    review_threads: 90,
    not_mergeable: 80,
    merge_candidate: 70,
    ci_pending: 60,
    mergeability_unknown: 50,
    draft: 10,
  };
  return Math.max(0, ...reasons.map((reason) => weights[reason] ?? 0));
}

async function inspectPullRequest(
  source: Request,
  invoke: Invoke,
  ref: PullRequestRef,
): Promise<JsonObject> {
  const response = await invoke(
    internalRequest(source, INSPECT_PR_PATH, {
      repository: ref.repository,
      pullRequestNumber: ref.number,
    }),
  );
  const payload = await responseObject(response);
  if (!response.ok || payload?.ok !== true || !isObject(payload.data)) {
    return {
      type: 'pull_request',
      ...ref,
      attentionScore: 40,
      reasons: ['inspection_failed'],
      error: typeof payload?.error === 'string' ? payload.error : `inspect_${response.status}`,
    };
  }
  const snapshot = isObject(payload.data.finalizeSnapshot) ? payload.data.finalizeSnapshot : {};
  const reasons = prReasons(snapshot);
  return {
    type: 'pull_request',
    ...ref,
    headSha: stringValue(snapshot.headSha),
    ciState: stringValue(snapshot.ciState),
    mergeable: typeof snapshot.mergeable === 'boolean' ? snapshot.mergeable : null,
    unresolvedThreads: numberValue(snapshot.unresolvedThreads) ?? 0,
    activeChangeRequests: numberValue(snapshot.activeChangeRequests) ?? 0,
    reasons,
    attentionScore: prScore(reasons),
  };
}

function compactIssue(repository: string, value: JsonObject): JsonObject | null {
  if (isObject(value.pull_request)) return null;
  const number = numberValue(value.number);
  if (number === null || !Number.isInteger(number) || number < 1) return null;
  const assignees = Array.isArray(value.assignees)
    ? value.assignees.filter(isObject).map((assignee) => stringValue(assignee.login)).filter(Boolean)
    : [];
  const labels = Array.isArray(value.labels)
    ? value.labels.map((label) => (isObject(label) ? stringValue(label.name) : stringValue(label))).filter(Boolean)
    : [];
  const updatedAt = stringValue(value.updated_at);
  const updatedEpoch = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const staleDays = Number.isFinite(updatedEpoch)
    ? Math.floor((Date.now() - updatedEpoch) / DAY_MS)
    : null;
  const reasons = ['open_issue'];
  if (assignees.length === 0) reasons.push('unassigned_issue');
  if (staleDays !== null && staleDays >= STALE_ISSUE_DAYS) reasons.push('stale_issue');
  return {
    type: 'issue',
    repository,
    number,
    title: stringValue(value.title),
    user: isObject(value.user) ? stringValue(value.user.login) : null,
    assignees,
    labels,
    comments: numberValue(value.comments) ?? 0,
    updatedAt,
    staleDays,
    htmlUrl: stringValue(value.html_url),
    reasons,
    attentionScore: reasons.includes('unassigned_issue') ? 35 : reasons.includes('stale_issue') ? 25 : 20,
  };
}

async function issuesForRepository(
  source: Request,
  invoke: Invoke,
  repository: string,
  limit: number,
): Promise<{ repository: string; items: JsonObject[]; error: string | null }> {
  try {
    const data = await readData(
      source,
      invoke,
      `/repos/${repoPath(repository)}/issues?state=open&sort=updated&direction=desc&per_page=100`,
    );
    const items = Array.isArray(data)
      ? data
          .filter(isObject)
          .map((issue) => compactIssue(repository, issue))
          .filter((issue): issue is JsonObject => Boolean(issue))
          .slice(0, limit)
      : [];
    return { repository, items, error: Array.isArray(data) ? null : 'invalid_issues_response' };
  } catch (error) {
    return {
      repository,
      items: [],
      error: error instanceof Error ? error.message.slice(0, 200) : 'issues_read_failed',
    };
  }
}

function maintenanceItems(repositories: JsonObject[]): JsonObject[] {
  return repositories
    .filter((repository) => Array.isArray(repository.attention) && repository.attention.length > 0)
    .map((repository) => ({
      type: 'repository_maintenance',
      repository: stringValue(repository.name),
      reasons: repository.attention,
      attentionScore: 45,
    }));
}

function attentionSort(left: JsonObject, right: JsonObject): number {
  const score = (numberValue(right.attentionScore) ?? 0) - (numberValue(left.attentionScore) ?? 0);
  if (score) return score;
  const leftKey = `${stringValue(left.repository) ?? ''}#${numberValue(left.number) ?? 0}`;
  const rightKey = `${stringValue(right.repository) ?? ''}#${numberValue(right.number) ?? 0}`;
  return leftKey.localeCompare(rightKey);
}

async function accountAttention(request: Request, invoke: Invoke): Promise<Response> {
  const input = await inputObject(request);
  const maintenanceResponse = await invoke(internalRequest(request, MAINTENANCE_PATH));
  const maintenance = await responseObject(maintenanceResponse);
  if (!maintenanceResponse.ok || maintenance?.ok !== true) return maintenanceResponse;

  const repositories = repositoriesFromMaintenance(maintenance).slice(0, input.maxRepositories);
  const repositoryNames = repositories
    .map((repository) => stringValue(repository.name))
    .filter((name): name is string => Boolean(name));
  const prRefs = pullRequestRefs(repositories).slice(0, input.maxPullRequests);

  const [pullRequests, issueGroups] = await Promise.all([
    mapLimit(prRefs, 3, (ref) => inspectPullRequest(request, invoke, ref)),
    mapLimit(repositoryNames, 4, (repository) =>
      issuesForRepository(request, invoke, repository, input.issuesPerRepository),
    ),
  ]);
  const issues = issueGroups.flatMap((group) => group.items);
  const maintenanceQueue = maintenanceItems(repositories);
  const queue = [...pullRequests, ...maintenanceQueue, ...issues].sort(attentionSort);

  return json({
    ok: true,
    account: 'trvny',
    limits: input,
    summary: {
      repositories: repositories.length,
      inspectedPullRequests: pullRequests.length,
      issues: issues.length,
      maintenanceRepositories: maintenanceQueue.length,
      partialIssueRepositories: issueGroups.filter((group) => group.error).length,
    },
    queue,
    pullRequests,
    issues,
    maintenance: maintenanceQueue,
    errors: issueGroups
      .filter((group) => group.error)
      .map((group) => ({ repository: group.repository, area: 'issues', error: group.error })),
    policyApplied: maintenance.policyApplied ?? null,
    policyExcluded: maintenance.policyExcluded ?? [],
  });
}

export function addAccountAttentionOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[ACCOUNT_ATTENTION_PATH] = {
    post: {
      operationId: 'getAccountAttention',
      summary: 'Sweep trvny repositories for PRs and issues needing attention',
      description:
        'Builds a read-only policy-scoped attention queue from maintenance state, bounded PR inspection and open issues. Performs no mutations.',
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                maxRepositories: { type: 'integer', minimum: 1, maximum: HARD_MAX_REPOSITORIES, default: DEFAULT_MAX_REPOSITORIES },
                maxPullRequests: { type: 'integer', minimum: 1, maximum: HARD_MAX_PULL_REQUESTS, default: DEFAULT_MAX_PULL_REQUESTS },
                issuesPerRepository: { type: 'integer', minimum: 1, maximum: HARD_ISSUES_PER_REPOSITORY, default: DEFAULT_ISSUES_PER_REPOSITORY },
              },
            },
          },
        },
      },
      responses: {
        '200': {
          description: 'Account attention queue',
          content: { 'application/json': { schema: { type: 'object', properties: {} } } },
        },
      },
    },
  };
}

export async function handleAccountAttentionAction(
  request: Request,
  invoke: Invoke,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== ACCOUNT_ATTENTION_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await accountAttention(request, invoke);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'account_attention_failed';
    const status = message === 'payload_too_large' ? 413 : 400;
    return json({ ok: false, error: message }, status);
  }
}
