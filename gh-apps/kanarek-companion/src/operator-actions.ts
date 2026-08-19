import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const BOT_PATH = '/gpt-actions/github/bot';
const GRAPHQL_PATH = '/gpt-actions/github/graphql';
const CONTEXT_PATH = '/gpt-actions/github/context';
const INSPECT_PR_PATH = '/gpt-actions/github/pull-requests/inspect';
const DIAGNOSE_RUN_PATH = '/gpt-actions/github/workflows/diagnose';
const FINALIZE_PR_PATH = '/gpt-actions/github/pull-requests/finalize';
const SHA_RE = /^[0-9a-f]{40}$/i;
const OK_CHECK_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

type JsonObject = Record<string, unknown>;

class OperatorError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'OperatorError';
    this.code = code;
    this.status = status;
  }
}

export interface FinalizeSnapshot {
  state: string;
  draft: boolean;
  headSha: string;
  mergeable: boolean | null;
  ciState: 'none' | 'pending' | 'failure' | 'success';
  unresolvedThreads: number;
  activeChangeRequests: number;
}

export interface CiSummary {
  state: FinalizeSnapshot['ciState'];
  [key: string]: unknown;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new OperatorError('repository_not_allowed', 403);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new OperatorError(`invalid_${name}`);
  }
  return value;
}

function expectedSha(value: unknown): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new OperatorError('invalid_expected_head_sha');
  }
  return value.toLowerCase();
}

function repoPath(repositoryName: string): string {
  return repositoryName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function internalRequest(source: Request, pathname: string, body: JsonObject): Request {
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

async function responsePayload(response: Response): Promise<JsonObject> {
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    throw new OperatorError('invalid_action_response', 502);
  }
  if (!isObject(payload)) throw new OperatorError('invalid_action_response', 502);
  if (!response.ok) {
    const code = typeof payload.error === 'string' ? payload.error : 'action_failed';
    throw new OperatorError(code, response.status);
  }
  return payload;
}

async function actionData(response: Response): Promise<unknown> {
  const payload = await responsePayload(response);
  return payload.data;
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
  return actionData(await readResponse(source, env, fetcher, path));
}

async function graphqlData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  query: string,
  variables: JsonObject,
): Promise<unknown> {
  return actionData(
    await handleGptActions(
      internalRequest(source, GRAPHQL_PATH, { query, variables }),
      env,
      fetcher,
    ),
  );
}

async function botData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  method: string,
  path: string,
  body?: JsonObject,
): Promise<unknown> {
  return actionData(
    await handleGptActions(
      internalRequest(source, BOT_PATH, {
        method,
        path,
        ...(body ? { body } : {}),
      }),
      env,
      fetcher,
    ),
  );
}

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > 64_000) throw new OperatorError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new OperatorError('invalid_json');
  }
  if (!isObject(value)) throw new OperatorError('invalid_json_object');
  return value;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function compactUser(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  return {
    login: stringValue(value.login),
    id: numberValue(value.id),
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
    user: compactUser(value.user),
    headRef: stringValue(head.ref),
    headSha: stringValue(head.sha),
    baseRef: stringValue(base.ref),
    baseSha: stringValue(base.sha),
    mergeable: typeof value.mergeable === 'boolean' ? value.mergeable : null,
    mergeableState: stringValue(value.mergeable_state),
    htmlUrl: stringValue(value.html_url),
    updatedAt: stringValue(value.updated_at),
  };
}

function decodeGithubContent(value: unknown): string | null {
  if (!isObject(value) || value.encoding !== 'base64' || typeof value.content !== 'string') {
    return null;
  }
  try {
    const binary = atob(value.content.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function compactWorkflowRun(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  return {
    id: numberValue(value.id),
    name: stringValue(value.name),
    event: stringValue(value.event),
    status: stringValue(value.status),
    conclusion: stringValue(value.conclusion),
    headBranch: stringValue(value.head_branch),
    headSha: stringValue(value.head_sha),
    htmlUrl: stringValue(value.html_url),
    createdAt: stringValue(value.created_at),
    updatedAt: stringValue(value.updated_at),
  };
}

function compactCommit(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const commit = isObject(value.commit) ? value.commit : {};
  const author = isObject(commit.author) ? commit.author : {};
  return {
    sha: stringValue(value.sha),
    message: stringValue(commit.message),
    author: stringValue(author.name),
    date: stringValue(author.date),
    htmlUrl: stringValue(value.html_url),
  };
}

function compactComment(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const body = stringValue(value.body);
  return {
    id: numberValue(value.id),
    user: compactUser(value.user),
    body: body ? body.slice(0, 2_000) : null,
    htmlUrl: stringValue(value.html_url),
    createdAt: stringValue(value.created_at),
    updatedAt: stringValue(value.updated_at),
  };
}

function compactReview(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const body = stringValue(value.body);
  return {
    id: numberValue(value.id),
    user: compactUser(value.user),
    state: stringValue(value.state),
    body: body ? body.slice(0, 2_000) : null,
    submittedAt: stringValue(value.submitted_at),
    htmlUrl: stringValue(value.html_url),
  };
}

function compactChangedFile(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const patch = stringValue(value.patch);
  return {
    filename: stringValue(value.filename),
    status: stringValue(value.status),
    additions: numberValue(value.additions),
    deletions: numberValue(value.deletions),
    changes: numberValue(value.changes),
    patch: patch ? patch.slice(0, 4_000) : null,
  };
}

function activeChangeRequests(reviews: unknown[]): JsonObject[] {
  const latest = new Map<string, JsonObject>();
  for (const item of reviews) {
    if (!isObject(item) || !isObject(item.user) || typeof item.user.login !== 'string') continue;
    const previous = latest.get(item.user.login);
    const submittedAt = stringValue(item.submitted_at) ?? '';
    const previousAt = previous ? stringValue(previous.submitted_at) ?? '' : '';
    if (!previous || submittedAt >= previousAt) latest.set(item.user.login, item);
  }
  return [...latest.values()]
    .filter((review) => review.state === 'CHANGES_REQUESTED')
    .map((review) => compactReview(review))
    .filter((review): review is JsonObject => Boolean(review));
}

export function summarizeCi(statusValue: unknown, checksValue: unknown): CiSummary {
  const status = isObject(statusValue) ? statusValue : {};
  const statuses = arrayValue(status.statuses).filter(isObject);
  const checksObject = isObject(checksValue) ? checksValue : {};
  const checks = arrayValue(checksObject.check_runs).filter(isObject);

  const failedChecks = checks.filter(
    (check) =>
      check.status === 'completed' &&
      typeof check.conclusion === 'string' &&
      !OK_CHECK_CONCLUSIONS.has(check.conclusion),
  );
  const pendingChecks = checks.filter((check) => check.status !== 'completed');
  const hasStatuses = statuses.length > 0;
  const hasChecks = checks.length > 0;
  const statusState = stringValue(status.state);
  const statusFailed = hasStatuses && (statusState === 'failure' || statusState === 'error');
  const statusPending = hasStatuses && statusState === 'pending';

  let state: FinalizeSnapshot['ciState'];
  if (!hasStatuses && !hasChecks) state = 'none';
  else if (statusFailed || failedChecks.length) state = 'failure';
  else if (statusPending || pendingChecks.length) state = 'pending';
  else state = 'success';

  return {
    state,
    combinedStatus: statusState,
    statuses: statuses.slice(0, 30).map((entry) => ({
      context: stringValue(entry.context),
      state: stringValue(entry.state),
      description: stringValue(entry.description),
      targetUrl: stringValue(entry.target_url),
    })),
    checks: checks.slice(0, 50).map((check) => ({
      id: numberValue(check.id),
      name: stringValue(check.name),
      status: stringValue(check.status),
      conclusion: stringValue(check.conclusion),
      htmlUrl: stringValue(check.html_url),
    })),
    failedChecks: failedChecks.map((check) => stringValue(check.name)).filter(Boolean),
    pendingChecks: pendingChecks.map((check) => stringValue(check.name)).filter(Boolean),
  };
}

function reviewThreads(graphqlValue: unknown): JsonObject[] {
  if (!isObject(graphqlValue) || !isObject(graphqlValue.data)) return [];
  const node = isObject(graphqlValue.data.node) ? graphqlValue.data.node : null;
  if (!node || !isObject(node.reviewThreads)) return [];
  return arrayValue(node.reviewThreads.nodes)
    .filter(isObject)
    .map((thread) => {
      const comments = isObject(thread.comments) ? arrayValue(thread.comments.nodes) : [];
      const first = comments.find(isObject);
      const body = first ? stringValue(first.body) : null;
      return {
        id: stringValue(thread.id),
        isResolved: thread.isResolved === true,
        isOutdated: thread.isOutdated === true,
        comment: first
          ? {
              id: stringValue(first.id),
              author: isObject(first.author) ? stringValue(first.author.login) : null,
              body: body ? body.slice(0, 2_000) : null,
              url: stringValue(first.url),
            }
          : null,
      };
    });
}

async function inspectPullRequestData(
  source: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repositoryName: string,
  pullRequestNumber: number,
): Promise<JsonObject> {
  const repo = repoPath(repositoryName);
  const prRaw = await readData(source, env, fetcher, `/repos/${repo}/pulls/${pullRequestNumber}`);
  if (!isObject(prRaw)) throw new OperatorError('invalid_pull_request_response', 502);
  const head = isObject(prRaw.head) ? prRaw.head : {};
  const headSha = stringValue(head.sha);
  const nodeId = stringValue(prRaw.node_id);
  if (!headSha || !SHA_RE.test(headSha) || !nodeId) {
    throw new OperatorError('invalid_pull_request_response', 502);
  }

  const [filesRaw, issueCommentsRaw, reviewsRaw, reviewCommentsRaw, statusRaw, checksRaw, threadsRaw] =
    await Promise.all([
      readData(source, env, fetcher, `/repos/${repo}/pulls/${pullRequestNumber}/files?per_page=100`),
      readData(source, env, fetcher, `/repos/${repo}/issues/${pullRequestNumber}/comments?per_page=100`),
      readData(source, env, fetcher, `/repos/${repo}/pulls/${pullRequestNumber}/reviews?per_page=100`),
      readData(source, env, fetcher, `/repos/${repo}/pulls/${pullRequestNumber}/comments?per_page=100`),
      readData(source, env, fetcher, `/repos/${repo}/commits/${headSha}/status`),
      readData(source, env, fetcher, `/repos/${repo}/commits/${headSha}/check-runs?per_page=100`),
      graphqlData(
        source,
        env,
        fetcher,
        'query($id: ID!) { node(id: $id) { ... on PullRequest { reviewThreads(first: 100) { nodes { id isResolved isOutdated comments(first: 1) { nodes { id body url author { login } } } } } } } }',
        { id: nodeId },
      ),
    ]);

  const files = arrayValue(filesRaw);
  const issueComments = arrayValue(issueCommentsRaw);
  const reviews = arrayValue(reviewsRaw);
  const reviewComments = arrayValue(reviewCommentsRaw);
  const threads = reviewThreads(threadsRaw);
  const unresolvedThreads = threads.filter(
    (thread) => thread.isResolved !== true && thread.isOutdated !== true,
  );
  const changeRequests = activeChangeRequests(reviews);
  const ci = summarizeCi(statusRaw, checksRaw);

  return {
    pullRequest: compactPullRequest(prRaw),
    changedFiles: files
      .slice(0, 30)
      .map(compactChangedFile)
      .filter((file): file is JsonObject => Boolean(file)),
    changedFilesTruncated: files.length > 30,
    issueComments: issueComments
      .slice(-12)
      .map(compactComment)
      .filter((comment): comment is JsonObject => Boolean(comment)),
    reviewComments: reviewComments
      .slice(-20)
      .map(compactComment)
      .filter((comment): comment is JsonObject => Boolean(comment)),
    reviews: reviews
      .slice(-20)
      .map(compactReview)
      .filter((review): review is JsonObject => Boolean(review)),
    activeChangeRequests: changeRequests,
    reviewThreads: threads,
    unresolvedThreads,
    ci,
    finalizeSnapshot: {
      state: stringValue(prRaw.state) ?? 'unknown',
      draft: prRaw.draft === true,
      headSha: headSha.toLowerCase(),
      mergeable: typeof prRaw.mergeable === 'boolean' ? prRaw.mergeable : null,
      ciState: ci.state,
      unresolvedThreads: unresolvedThreads.length,
      activeChangeRequests: changeRequests.length,
    } satisfies FinalizeSnapshot,
  };
}

export function finalizeBlockers(
  snapshot: FinalizeSnapshot,
  expectedHeadSha: string,
): string[] {
  const blockers: string[] = [];
  if (snapshot.state !== 'open') blockers.push('pull_request_not_open');
  if (snapshot.draft) blockers.push('pull_request_is_draft');
  if (snapshot.headSha.toLowerCase() !== expectedHeadSha.toLowerCase()) blockers.push('head_sha_changed');
  if (snapshot.mergeable === null) blockers.push('mergeability_unknown');
  else if (!snapshot.mergeable) blockers.push('pull_request_not_mergeable');
  if (snapshot.ciState === 'pending') blockers.push('ci_pending');
  if (snapshot.ciState === 'failure') blockers.push('ci_failed');
  if (snapshot.unresolvedThreads > 0) blockers.push('unresolved_review_threads');
  if (snapshot.activeChangeRequests > 0) blockers.push('changes_requested');
  return blockers;
}

async function repositoryContext(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const repo = repoPath(repositoryName);
  const repositoryRaw = await readData(request, env, fetcher, `/repos/${repo}`);
  if (!isObject(repositoryRaw) || typeof repositoryRaw.default_branch !== 'string') {
    throw new OperatorError('invalid_repository_response', 502);
  }
  const defaultBranch = repositoryRaw.default_branch;
  const encodedBranch = defaultBranch
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  const [headRaw, pullsRaw, commitsRaw, runsRaw, agentsResponse] = await Promise.all([
    readData(request, env, fetcher, `/repos/${repo}/git/ref/heads/${encodedBranch}`),
    readData(request, env, fetcher, `/repos/${repo}/pulls?state=open&per_page=20`),
    readData(request, env, fetcher, `/repos/${repo}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=10`),
    readData(request, env, fetcher, `/repos/${repo}/actions/runs?branch=${encodeURIComponent(defaultBranch)}&per_page=20`),
    readResponse(request, env, fetcher, `/repos/${repo}/contents/AGENTS.md?ref=${encodeURIComponent(defaultBranch)}`),
  ]);

  const headObject = isObject(headRaw) && isObject(headRaw.object) ? headRaw.object : null;
  const headSha = headObject ? stringValue(headObject.sha) : null;
  const pulls = arrayValue(pullsRaw);
  const commits = arrayValue(commitsRaw);
  const runs = isObject(runsRaw) ? arrayValue(runsRaw.workflow_runs) : [];
  let agents: string | null = null;
  if (agentsResponse.ok) {
    agents = decodeGithubContent(await actionData(agentsResponse));
  } else if (agentsResponse.status !== 404) {
    await responsePayload(agentsResponse);
  }

  return json({
    ok: true,
    repository: {
      fullName: stringValue(repositoryRaw.full_name),
      defaultBranch,
      private: repositoryRaw.private === true,
      archived: repositoryRaw.archived === true,
      htmlUrl: stringValue(repositoryRaw.html_url),
    },
    headSha,
    agents,
    openPullRequests: pulls
      .map(compactPullRequest)
      .filter((pr): pr is JsonObject => Boolean(pr)),
    recentCommits: commits
      .map(compactCommit)
      .filter((commit): commit is JsonObject => Boolean(commit)),
    recentWorkflowRuns: runs
      .slice(0, 10)
      .map(compactWorkflowRun)
      .filter((run): run is JsonObject => Boolean(run)),
    recentFailedWorkflowRuns: runs
      .filter((run) => isObject(run) && run.conclusion === 'failure')
      .slice(0, 5)
      .map(compactWorkflowRun)
      .filter((run): run is JsonObject => Boolean(run)),
  });
}

async function inspectPullRequest(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const pullRequestNumber = positiveInteger(input.pullRequestNumber, 'pull_request_number');
  return json({
    ok: true,
    data: await inspectPullRequestData(request, env, fetcher, repositoryName, pullRequestNumber),
  });
}

function compactJob(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const steps = arrayValue(value.steps).filter(isObject);
  return {
    id: numberValue(value.id),
    name: stringValue(value.name),
    status: stringValue(value.status),
    conclusion: stringValue(value.conclusion),
    htmlUrl: stringValue(value.html_url),
    failedSteps: steps
      .filter((step) => step.conclusion && !OK_CHECK_CONCLUSIONS.has(String(step.conclusion)))
      .map((step) => ({
        number: numberValue(step.number),
        name: stringValue(step.name),
        status: stringValue(step.status),
        conclusion: stringValue(step.conclusion),
      })),
  };
}

async function diagnoseWorkflowRun(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const runId = positiveInteger(input.runId, 'run_id');
  const repo = repoPath(repositoryName);
  const [runRaw, jobsRaw] = await Promise.all([
    readData(request, env, fetcher, `/repos/${repo}/actions/runs/${runId}`),
    readData(request, env, fetcher, `/repos/${repo}/actions/runs/${runId}/jobs?per_page=100`),
  ]);
  if (!isObject(runRaw) || !isObject(jobsRaw)) {
    throw new OperatorError('invalid_workflow_response', 502);
  }
  const jobs = arrayValue(jobsRaw.jobs).filter(isObject);
  const failedJobs = jobs.filter(
    (job) =>
      job.conclusion &&
      typeof job.conclusion === 'string' &&
      !OK_CHECK_CONCLUSIONS.has(job.conclusion),
  );
  const logJobs = failedJobs.slice(0, 3);
  const logs = await Promise.all(
    logJobs.map(async (job) => {
      const id = numberValue(job.id);
      if (!id) return { jobId: null, excerpt: null };
      const response = await readResponse(request, env, fetcher, `/repos/${repo}/actions/jobs/${id}/logs`);
      if (!response.ok) {
        return { jobId: id, excerpt: null, error: `http_${response.status}` };
      }
      const data = await actionData(response);
      const excerpt = isObject(data) && typeof data.text === 'string' ? data.text.slice(0, 10_000) : null;
      return { jobId: id, excerpt };
    }),
  );

  return json({
    ok: true,
    run: compactWorkflowRun(runRaw),
    jobs: jobs.map(compactJob).filter((job): job is JsonObject => Boolean(job)),
    failingJobs: failedJobs.map(compactJob).filter((job): job is JsonObject => Boolean(job)),
    logExcerpts: logs,
  });
}

async function finalizePullRequest(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const pullRequestNumber = positiveInteger(input.pullRequestNumber, 'pull_request_number');
  const headSha = expectedSha(input.expectedHeadSha);
  const mergeMethod =
    input.mergeMethod === 'merge' || input.mergeMethod === 'rebase' ? input.mergeMethod : 'squash';
  const inspection = await inspectPullRequestData(
    request,
    env,
    fetcher,
    repositoryName,
    pullRequestNumber,
  );
  const snapshot = inspection.finalizeSnapshot;
  if (!isObject(snapshot)) throw new OperatorError('invalid_finalize_snapshot', 502);
  const typedSnapshot = snapshot as unknown as FinalizeSnapshot;
  const blockers = finalizeBlockers(typedSnapshot, headSha);
  if (blockers.length) {
    return json({ ok: false, merged: false, blockers, inspection }, 409);
  }

  const repo = repoPath(repositoryName);
  const merge = await botData(
    request,
    env,
    fetcher,
    'PUT',
    `/repos/${repo}/pulls/${pullRequestNumber}/merge`,
    { sha: headSha, merge_method: mergeMethod },
  );
  if (!isObject(merge) || merge.merged !== true) {
    throw new OperatorError('merge_not_confirmed', 409);
  }
  return json({ ok: true, merged: true, mergeMethod, merge });
}

function objectResponse(description: string): JsonObject {
  return {
    '200': {
      description,
      content: {
        'application/json': {
          schema: { type: 'object', properties: {} },
        },
      },
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

export function addOperatorOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[CONTEXT_PATH] = {
    post: {
      operationId: 'getRepositoryContext',
      summary: 'Load repository context for a work session',
      description:
        'Returns default-branch state, root AGENTS.md, open PRs, recent commits and workflow failures for one trvny repository.',
      requestBody: requestSchema(['repository'], {
        repository: { type: 'string', example: 'trvny/feedseek' },
      }),
      responses: objectResponse('Repository context'),
    },
  };
  paths[INSPECT_PR_PATH] = {
    post: {
      operationId: 'inspectPullRequest',
      summary: 'Inspect a pull request in one call',
      description:
        'Returns PR metadata, changed-file patches, comments, reviews, review threads and CI state. Large collections are capped.',
      requestBody: requestSchema(['repository', 'pullRequestNumber'], {
        repository: { type: 'string' },
        pullRequestNumber: { type: 'integer', minimum: 1 },
      }),
      responses: objectResponse('Pull request inspection'),
    },
  };
  paths[DIAGNOSE_RUN_PATH] = {
    post: {
      operationId: 'diagnoseWorkflowRun',
      summary: 'Diagnose a GitHub Actions workflow run',
      description:
        'Returns run state, jobs, failed steps and short log excerpts for up to three failing jobs.',
      requestBody: requestSchema(['repository', 'runId'], {
        repository: { type: 'string' },
        runId: { type: 'integer', minimum: 1 },
      }),
      responses: objectResponse('Workflow diagnosis'),
    },
  };
  paths[FINALIZE_PR_PATH] = {
    post: {
      operationId: 'finalizePullRequest',
      summary: 'Safely merge a ready pull request',
      description:
        'Checks expected head SHA, draft/open state, mergeability, CI, unresolved review threads and active change requests before merging as gptomek[bot].',
      requestBody: requestSchema(
        ['repository', 'pullRequestNumber', 'expectedHeadSha'],
        {
          repository: { type: 'string' },
          pullRequestNumber: { type: 'integer', minimum: 1 },
          expectedHeadSha: { type: 'string' },
          mergeMethod: { type: 'string', enum: ['squash', 'merge', 'rebase'], default: 'squash' },
        },
      ),
      responses: objectResponse('Merge result or blockers'),
    },
  };
}

export async function handleOperatorAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (![CONTEXT_PATH, INSPECT_PR_PATH, DIAGNOSE_RUN_PATH, FINALIZE_PR_PATH].includes(pathname)) {
    return null;
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    if (pathname === CONTEXT_PATH) return repositoryContext(request, env, fetcher);
    if (pathname === INSPECT_PR_PATH) return inspectPullRequest(request, env, fetcher);
    if (pathname === DIAGNOSE_RUN_PATH) return diagnoseWorkflowRun(request, env, fetcher);
    return finalizePullRequest(request, env, fetcher);
  } catch (error) {
    if (error instanceof OperatorError) return json({ ok: false, error: error.code }, error.status);
    console.error(
      JSON.stringify({
        gptOperator: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'operator_internal_error' }, 500);
  }
}
