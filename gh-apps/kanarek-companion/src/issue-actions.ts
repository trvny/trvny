import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const BOT_PATH = '/gpt-actions/github/bot';
const ISSUE_CONTEXT_PATH = '/gpt-actions/github/issues/context';
const ISSUE_TRIAGE_PATH = '/gpt-actions/github/issues/triage';

type JsonObject = Record<string, unknown>;

class IssueActionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'IssueActionError';
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
    throw new IssueActionError('repository_not_allowed', 403);
  }
  return value;
}

function issueNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new IssueActionError('invalid_issue_number');
  }
  return value;
}

function repoPath(value: string): string {
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
  if (text.length > 96_000) throw new IssueActionError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new IssueActionError('invalid_json');
  }
  if (!isObject(value)) throw new IssueActionError('invalid_json_object');
  return value;
}

async function responsePayload(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new IssueActionError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new IssueActionError('invalid_action_response', 502);
  if (!response.ok) {
    throw new IssueActionError(
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
  return (await responsePayload(response)).data;
}

async function botData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  method: string,
  path: string,
  body: JsonObject,
): Promise<unknown> {
  const response = await handleGptActions(
    internalRequest(source, BOT_PATH, { method, path, body }),
    env,
    fetcher,
  );
  return (await responsePayload(response)).data;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactUser(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  return { login: stringValue(value.login), id: numberValue(value.id) };
}

function labelNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (isObject(entry) ? stringValue(entry.name) : stringValue(entry)))
    .filter((entry): entry is string => Boolean(entry));
}

function assigneeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (isObject(entry) ? stringValue(entry.login) : null))
    .filter((entry): entry is string => Boolean(entry));
}

function compactIssue(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const body = stringValue(value.body);
  const milestone = isObject(value.milestone) ? value.milestone : null;
  return {
    number: numberValue(value.number),
    title: stringValue(value.title),
    body: body ? body.slice(0, 12_000) : null,
    state: stringValue(value.state),
    stateReason: stringValue(value.state_reason),
    isPullRequest: isObject(value.pull_request),
    user: compactUser(value.user),
    labels: labelNames(value.labels),
    assignees: assigneeNames(value.assignees),
    milestone: milestone
      ? { number: numberValue(milestone.number), title: stringValue(milestone.title) }
      : null,
    comments: numberValue(value.comments),
    locked: value.locked === true,
    htmlUrl: stringValue(value.html_url),
    createdAt: stringValue(value.created_at),
    updatedAt: stringValue(value.updated_at),
    closedAt: stringValue(value.closed_at),
  };
}

function compactComment(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const body = stringValue(value.body);
  return {
    id: numberValue(value.id),
    user: compactUser(value.user),
    body: body ? body.slice(0, 4_000) : null,
    htmlUrl: stringValue(value.html_url),
    createdAt: stringValue(value.created_at),
    updatedAt: stringValue(value.updated_at),
  };
}

function compactTimelineEvent(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const source = isObject(value.source) ? value.source : null;
  const sourceIssue = source && isObject(source.issue) ? source.issue : null;
  const rename = isObject(value.rename) ? value.rename : null;
  const label = isObject(value.label) ? value.label : null;
  const assignee = isObject(value.assignee) ? value.assignee : null;
  const body = stringValue(value.body);
  return {
    id: numberValue(value.id),
    event: stringValue(value.event),
    actor: compactUser(value.actor ?? value.user),
    commitId: stringValue(value.commit_id),
    createdAt: stringValue(value.created_at),
    body: body ? body.slice(0, 2_000) : null,
    label: label ? stringValue(label.name) : null,
    assignee: assignee ? stringValue(assignee.login) : null,
    rename: rename
      ? { from: stringValue(rename.from), to: stringValue(rename.to) }
      : null,
    sourceIssue: sourceIssue
      ? {
          number: numberValue(sourceIssue.number),
          title: stringValue(sourceIssue.title),
          state: stringValue(sourceIssue.state),
          isPullRequest: isObject(sourceIssue.pull_request),
          htmlUrl: stringValue(sourceIssue.html_url),
          repositoryUrl: stringValue(sourceIssue.repository_url),
        }
      : null,
  };
}

function relatedFromTimeline(events: unknown[]): { pullRequests: JsonObject[]; commits: string[] } {
  const pullRequests = new Map<string, JsonObject>();
  const commits = new Set<string>();
  for (const raw of events) {
    if (!isObject(raw)) continue;
    if (typeof raw.commit_id === 'string') commits.add(raw.commit_id);
    const source = isObject(raw.source) ? raw.source : null;
    const issue = source && isObject(source.issue) ? source.issue : null;
    if (!issue || !isObject(issue.pull_request)) continue;
    const url = stringValue(issue.html_url);
    const key = url ?? `${stringValue(issue.repository_url)}#${numberValue(issue.number)}`;
    pullRequests.set(key, {
      number: numberValue(issue.number),
      title: stringValue(issue.title),
      state: stringValue(issue.state),
      htmlUrl: url,
      repositoryUrl: stringValue(issue.repository_url),
    });
  }
  return { pullRequests: [...pullRequests.values()], commits: [...commits] };
}

async function getIssueContext(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const number = issueNumber(input.issueNumber);
  const repo = repoPath(repositoryName);
  const [issue, commentsRaw, timelineRaw] = await Promise.all([
    readData(request, env, fetcher, `/repos/${repo}/issues/${number}`),
    readData(request, env, fetcher, `/repos/${repo}/issues/${number}/comments?per_page=100`),
    readData(request, env, fetcher, `/repos/${repo}/issues/${number}/timeline?per_page=100`),
  ]);
  if (!isObject(issue)) throw new IssueActionError('invalid_issue_response', 502);
  const comments = Array.isArray(commentsRaw) ? commentsRaw : [];
  const timeline = Array.isArray(timelineRaw) ? timelineRaw : [];
  const related = relatedFromTimeline(timeline);
  return json({
    ok: true,
    issue: compactIssue(issue),
    comments: comments
      .slice(-60)
      .map(compactComment)
      .filter((entry): entry is JsonObject => Boolean(entry)),
    timeline: timeline
      .slice(-100)
      .map(compactTimelineEvent)
      .filter((entry): entry is JsonObject => Boolean(entry)),
    relatedPullRequests: related.pullRequests,
    relatedCommits: related.commits,
  });
}

function stringList(value: unknown, name: string, maxItems: number, maxLength: number): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maxItems) throw new IssueActionError(`invalid_${name}`);
  const result = value.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > maxLength) {
      throw new IssueActionError(`invalid_${name}`);
    }
    return entry.trim();
  });
  if (new Set(result).size !== result.length) throw new IssueActionError(`duplicate_${name}`);
  return result;
}

export function nextIssueLabels(
  current: string[],
  add: string[] | undefined,
  remove: string[] | undefined,
): string[] | undefined {
  if (add === undefined && remove === undefined) return undefined;
  const labels = new Set(current);
  for (const label of add ?? []) labels.add(label);
  for (const label of remove ?? []) labels.delete(label);
  return [...labels];
}

export function issueStateReasonAllowed(state: unknown, reason: unknown): boolean {
  if (state !== 'open' && state !== 'closed') return false;
  if (typeof reason !== 'string') return false;
  if (state === 'open') return reason === 'reopened';
  return reason === 'completed' || reason === 'not_planned' || reason === 'duplicate';
}

async function triageIssueAsGptomek(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const number = issueNumber(input.issueNumber);
  const addLabels = stringList(input.addLabels, 'add_labels', 30, 100);
  const removeLabels = stringList(input.removeLabels, 'remove_labels', 30, 100);
  const assignees = stringList(input.assignees, 'assignees', 10, 100);
  const repo = repoPath(repositoryName);
  const issueRaw = await readData(request, env, fetcher, `/repos/${repo}/issues/${number}`);
  if (!isObject(issueRaw)) throw new IssueActionError('invalid_issue_response', 502);

  const patch: JsonObject = {};
  const labels = nextIssueLabels(labelNames(issueRaw.labels), addLabels, removeLabels);
  if (labels !== undefined) patch.labels = labels;
  if (assignees !== undefined) patch.assignees = assignees;

  if (input.state !== undefined) {
    if (isObject(issueRaw.pull_request)) throw new IssueActionError('use_pull_request_state', 409);
    if (input.state !== 'open' && input.state !== 'closed') throw new IssueActionError('invalid_state');
    patch.state = input.state;
  }
  if (input.stateReason !== undefined) {
    if (input.state === undefined) throw new IssueActionError('state_reason_requires_state');
    if (!issueStateReasonAllowed(input.state, input.stateReason)) {
      throw new IssueActionError('invalid_state_reason');
    }
    patch.state_reason = input.stateReason;
  }
  if (!Object.keys(patch).length) throw new IssueActionError('no_triage_change');

  const updated = await botData(
    request,
    env,
    fetcher,
    'PATCH',
    `/repos/${repo}/issues/${number}`,
    patch,
  );
  if (!isObject(updated)) throw new IssueActionError('issue_update_not_confirmed', 502);
  return json({ ok: true, issue: compactIssue(updated) });
}

function objectResponse(description: string): JsonObject {
  return {
    '200': {
      description,
      content: { 'application/json': { schema: { type: 'object', properties: {} } } },
    },
  };
}

function requestBody(required: string[], properties: JsonObject): JsonObject {
  return {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', required, properties },
      },
    },
  };
}

export function addIssueOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[ISSUE_CONTEXT_PATH] = {
    post: {
      operationId: 'getIssueContext',
      summary: 'Inspect an issue and related activity',
      description:
        'Returns issue metadata, comments, timeline activity, cross-referenced pull requests and commit references in one request.',
      requestBody: requestBody(['repository', 'issueNumber'], {
        repository: { type: 'string', example: 'trvny/feedseek' },
        issueNumber: { type: 'integer', minimum: 1 },
      }),
      responses: objectResponse('Issue context'),
    },
  };
  paths[ISSUE_TRIAGE_PATH] = {
    post: {
      operationId: 'triageIssueAsGptomek',
      summary: 'Triage an issue as gptomek[bot]',
      description:
        'Adds or removes labels, replaces assignees, or changes issue state. Pull request state changes must use the dedicated PR action.',
      requestBody: requestBody(['repository', 'issueNumber'], {
        repository: { type: 'string' },
        issueNumber: { type: 'integer', minimum: 1 },
        addLabels: { type: 'array', items: { type: 'string' } },
        removeLabels: { type: 'array', items: { type: 'string' } },
        assignees: { type: 'array', items: { type: 'string' } },
        state: { type: 'string', enum: ['open', 'closed'] },
        stateReason: { type: 'string', enum: ['completed', 'not_planned', 'duplicate', 'reopened'] },
      }),
      responses: objectResponse('Updated issue'),
    },
  };
}

export async function handleIssueAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== ISSUE_CONTEXT_PATH && pathname !== ISSUE_TRIAGE_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return pathname === ISSUE_CONTEXT_PATH
      ? await getIssueContext(request, env, fetcher)
      : await triageIssueAsGptomek(request, env, fetcher);
  } catch (error) {
    if (error instanceof IssueActionError) return json({ ok: false, error: error.code }, error.status);
    console.error(
      JSON.stringify({
        gptIssue: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'issue_internal_error' }, 500);
  }
}
