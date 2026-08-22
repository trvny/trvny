import {
  autopilotInputHash,
  checkpointCall,
  operationIdAllowed,
  type AutopilotCheckpointEnv,
} from './autopilot-checkpoint.ts';
import { loadAgentGuidance } from './agents-guidance.ts';
import {
  DEPENDENCY_GRAPH_PATH,
  handleDependencyGraphAction,
} from './dependency-graph.ts';
import {
  handleTargetedTestsAction,
  TARGETED_TESTS_PATH,
} from './test-discovery.ts';

export const CODE_CHANGE_AUTOPILOT_PATH = '/gpt-actions/operator/code-change';

const PREPARE_CHANGE_PATH = '/gpt-actions/github/changes/prepare';
const INVESTIGATE_PATH = '/gpt-actions/github/code/investigate';
const READ_PATH = '/gpt-actions/github/read';
const COMMIT_FILES_PATH = '/gpt-actions/github/commit-files';
const CREATE_PR_PATH = '/gpt-actions/github/pull-requests';
const INSPECT_PR_PATH = '/gpt-actions/github/pull-requests/inspect';
const FINALIZE_PR_PATH = '/gpt-actions/github/pull-requests/finalize';
const CLEANUP_BRANCH_PATH = '/gpt-actions/github/pull-requests/cleanup-branch';
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_TARGETS = 6;
const MAX_FILES = 12;
const MAX_FILE_CONTENT = 96_000;

type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;
type Stage = 'editing' | 'verifying' | 'waiting_ci_review';
type MergeMethod = 'squash' | 'merge' | 'rebase';

type CoreInput = {
  operationId: string;
  repository: string;
  goal: string;
  branch: string;
  expectedBaseSha: string;
  targetPaths: string[];
  investigationTerms: string[];
  issueNumber?: number;
  path?: string;
  language?: string;
};

type EditFile = { path: string; content: string | null };
type EditAction = { type: 'edit'; message: string; files: EditFile[] };
type VerificationAction = {
  type: 'verification';
  status: 'passed' | 'failed' | 'unavailable';
  reason?: string;
  results?: JsonObject[];
  pullRequest?: { title: string; body: string };
};
type ReviewAction = {
  type: 'review';
  reviewedHeadSha: string;
  semanticReviewComplete: true;
  mergeMethod: MergeMethod;
};
type Action = EditAction | VerificationAction | ReviewAction;

type PullRequestProgress = {
  number: number;
  headSha: string;
  htmlUrl: string | null;
};

type Progress = JsonObject & {
  stage: Stage;
  defaultBranch: string;
  branchHead: string;
  revision: number;
  pullRequest?: PullRequestProgress;
  verification?: {
    status: 'passed' | 'unavailable';
    reason?: string;
  };
};

export type ReviewGateSnapshot = {
  state: string;
  baseRef: string;
  draft: boolean;
  headSha: string;
  mergeable: boolean | null;
  ciState: 'none' | 'pending' | 'failure' | 'success';
  unresolvedThreads: number;
  activeChangeRequests: number;
};

class CodeChangeError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: JsonObject;

  constructor(code: string, status = 400, details: JsonObject = {}) {
    super(code);
    this.name = 'CodeChangeError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(headers)) },
  });
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new CodeChangeError('repository_not_allowed', 403);
  }
  return value;
}

function branch(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 250 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('..') ||
    value.includes('//') ||
    !/^[A-Za-z0-9._/-]+$/.test(value)
  ) {
    throw new CodeChangeError('invalid_branch');
  }
  return value;
}

function expectedSha(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new CodeChangeError(`invalid_${name}`);
  }
  return value.toLowerCase();
}

function validPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value) &&
    value.length <= 600 &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.includes('..') &&
    !value.includes('//') &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

function targetPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TARGETS) {
    throw new CodeChangeError('invalid_target_paths');
  }
  const paths = value.map((path) => {
    if (!validPath(path)) throw new CodeChangeError('invalid_target_paths');
    return path;
  });
  if (new Set(paths).size !== paths.length) throw new CodeChangeError('invalid_target_paths');
  return paths;
}

function terms(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    throw new CodeChangeError('invalid_investigation_terms');
  }
  const result = value.map((term) => {
    if (typeof term !== 'string' || term.length < 2 || term.length > 80 || !/^[A-Za-z0-9_./@+-]+$/.test(term)) {
      throw new CodeChangeError('invalid_investigation_terms');
    }
    return term;
  });
  if (new Set(result.map((term) => term.toLowerCase())).size !== result.length) {
    throw new CodeChangeError('invalid_investigation_terms');
  }
  return result;
}

function optionalIssue(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new CodeChangeError('invalid_issue_number');
  }
  return value;
}

function optionalFilter(value: unknown, name: 'path' | 'language'): string | undefined {
  if (value === undefined) return undefined;
  const pattern = name === 'path' ? /^[A-Za-z0-9_./-]+$/ : /^[A-Za-z0-9#+._-]+$/;
  if (typeof value !== 'string' || !value || value.length > 300 || !pattern.test(value)) {
    throw new CodeChangeError(`invalid_${name}`);
  }
  return value;
}

function requiredText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new CodeChangeError(`invalid_${name}`);
  }
  return value;
}

function editFiles(value: unknown, scope: string[]): EditFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) {
    throw new CodeChangeError('invalid_files');
  }
  const allowed = new Set(scope);
  const files = value.map((entry) => {
    if (!isObject(entry) || !validPath(entry.path) || !allowed.has(entry.path)) {
      throw new CodeChangeError('edit_outside_declared_scope', 409);
    }
    if (entry.content !== null && typeof entry.content !== 'string') {
      throw new CodeChangeError('invalid_file_content');
    }
    if (typeof entry.content === 'string' && entry.content.length > MAX_FILE_CONTENT) {
      throw new CodeChangeError('file_content_too_large', 413);
    }
    return { path: entry.path, content: entry.content as string | null };
  });
  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new CodeChangeError('duplicate_file_path');
  }
  return files;
}

function action(value: unknown, scope: string[]): Action | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || typeof value.type !== 'string') throw new CodeChangeError('invalid_action');
  if (value.type === 'edit') {
    return {
      type: 'edit',
      message: requiredText(value.message, 'commit_message', 1_000),
      files: editFiles(value.files, scope),
    };
  }
  if (value.type === 'verification') {
    if (value.status !== 'passed' && value.status !== 'failed' && value.status !== 'unavailable') {
      throw new CodeChangeError('invalid_verification_status');
    }
    const reason = value.reason === undefined ? undefined : requiredText(value.reason, 'verification_reason', 2_000);
    if (value.status === 'unavailable' && !reason) throw new CodeChangeError('verification_reason_required');
    if (value.results !== undefined && (!Array.isArray(value.results) || value.results.length > 30 || !value.results.every(isObject))) {
      throw new CodeChangeError('invalid_verification_results');
    }
    let pullRequest: VerificationAction['pullRequest'];
    if (value.pullRequest !== undefined) {
      if (!isObject(value.pullRequest)) throw new CodeChangeError('invalid_pull_request');
      pullRequest = {
        title: requiredText(value.pullRequest.title, 'pull_request_title', 500),
        body: typeof value.pullRequest.body === 'string' && value.pullRequest.body.length <= 8_000
          ? value.pullRequest.body
          : '',
      };
    }
    return {
      type: 'verification',
      status: value.status,
      ...(reason ? { reason } : {}),
      ...(Array.isArray(value.results) ? { results: value.results as JsonObject[] } : {}),
      ...(pullRequest ? { pullRequest } : {}),
    };
  }
  if (value.type === 'review') {
    if (value.semanticReviewComplete !== true) throw new CodeChangeError('semantic_review_incomplete', 409);
    const mergeMethod = value.mergeMethod === undefined ? 'squash' : value.mergeMethod;
    if (mergeMethod !== 'squash' && mergeMethod !== 'merge' && mergeMethod !== 'rebase') {
      throw new CodeChangeError('invalid_merge_method');
    }
    return {
      type: 'review',
      reviewedHeadSha: expectedSha(value.reviewedHeadSha, 'reviewed_head_sha'),
      semanticReviewComplete: true,
      mergeMethod,
    };
  }
  throw new CodeChangeError('invalid_action');
}

async function parseInput(request: Request): Promise<{ core: CoreInput; action?: Action; inputHash: string }> {
  const text = await request.clone().text();
  if (text.length > 1_500_000) throw new CodeChangeError('payload_too_large', 413);
  let raw: unknown;
  try {
    raw = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new CodeChangeError('invalid_json');
  }
  if (!isObject(raw)) throw new CodeChangeError('invalid_json_object');
  const allowed = new Set([
    'operationId', 'repository', 'goal', 'branch', 'expectedBaseSha', 'targetPaths',
    'investigationTerms', 'issueNumber', 'path', 'language', 'action',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    throw new CodeChangeError('invalid_code_change_request');
  }
  if (!operationIdAllowed(raw.operationId)) throw new CodeChangeError('invalid_operation_id');
  const core: CoreInput = {
    operationId: String(raw.operationId),
    repository: repository(raw.repository),
    goal: requiredText(raw.goal, 'goal', 4_000),
    branch: branch(raw.branch),
    expectedBaseSha: expectedSha(raw.expectedBaseSha, 'expected_base_sha'),
    targetPaths: targetPaths(raw.targetPaths),
    investigationTerms: terms(raw.investigationTerms),
    issueNumber: optionalIssue(raw.issueNumber),
    path: optionalFilter(raw.path, 'path'),
    language: optionalFilter(raw.language, 'language'),
  };
  const coreHash = { ...core } as JsonObject;
  delete coreHash.operationId;
  return {
    core,
    action: action(raw.action, core.targetPaths),
    inputHash: await autopilotInputHash(coreHash),
  };
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

async function responseObject(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new CodeChangeError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new CodeChangeError('invalid_action_response', 502);
  return value;
}

async function invokePayload(
  source: Request,
  invoke: Invoke,
  pathname: string,
  body: JsonObject,
  allowError = false,
): Promise<{ response: Response; payload: JsonObject }> {
  const response = await invoke(internalRequest(source, pathname, body));
  const payload = await responseObject(response);
  if (!allowError && (!response.ok || payload.ok === false)) {
    throw new CodeChangeError(
      typeof payload.error === 'string' ? payload.error : `action_${response.status}`,
      response.status,
      payload,
    );
  }
  return { response, payload };
}

async function readData(source: Request, invoke: Invoke, path: string): Promise<unknown> {
  const { payload } = await invokePayload(source, invoke, READ_PATH, { path });
  return payload.data;
}

function repoPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function refPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function contentPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function decodeContent(value: unknown): string | null {
  if (!isObject(value) || value.encoding !== 'base64' || typeof value.content !== 'string') return null;
  try {
    const binary = atob(value.content.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

async function targetGuidance(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
): Promise<unknown> {
  return loadAgentGuidance(core.targetPaths, ref, async (path, pinnedRef) => {
    const { response, payload } = await invokePayload(
      source,
      invoke,
      READ_PATH,
      { path: `/repos/${repoPath(core.repository)}/contents/${contentPath(path)}?ref=${encodeURIComponent(pinnedRef)}` },
      true,
    );
    if (response.status === 404) return null;
    if (!response.ok || payload.ok !== true) {
      throw new CodeChangeError(
        typeof payload.error === 'string' ? payload.error : 'agent_guidance_read_failed',
        response.status,
      );
    }
    return payload.data;
  });
}

async function branchHead(source: Request, invoke: Invoke, core: CoreInput): Promise<string> {
  const raw = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/git/ref/heads/${refPath(core.branch)}`,
  );
  const sha = isObject(raw) && isObject(raw.object) ? stringValue(raw.object.sha) : null;
  if (!sha || !SHA_RE.test(sha)) throw new CodeChangeError('invalid_branch_ref_response', 502);
  return sha.toLowerCase();
}

async function defaultBranchHead(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
): Promise<{ defaultBranch: string; sha: string }> {
  const metadata = await readData(source, invoke, `/repos/${repoPath(core.repository)}`);
  const defaultBranch = isObject(metadata) ? stringValue(metadata.default_branch) : null;
  if (!defaultBranch) throw new CodeChangeError('invalid_repository_response', 502);
  const raw = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/git/ref/heads/${refPath(defaultBranch)}`,
  );
  const sha = isObject(raw) && isObject(raw.object) ? stringValue(raw.object.sha) : null;
  if (!sha || !SHA_RE.test(sha)) throw new CodeChangeError('invalid_default_branch_ref', 502);
  return { defaultBranch, sha: sha.toLowerCase() };
}

async function preparationContext(source: Request, invoke: Invoke, core: CoreInput): Promise<JsonObject> {
  const prepareBody: JsonObject = {
    repository: core.repository,
    branch: core.branch,
    expectedBaseSha: core.expectedBaseSha,
    targetPaths: core.targetPaths,
    ...(core.issueNumber ? { issueNumber: core.issueNumber } : {}),
  };
  const prepared = await invokePayload(source, invoke, PREPARE_CHANGE_PATH, prepareBody, true);
  if (prepared.response.ok && prepared.payload.ok === true) return prepared.payload;

  if (prepared.payload.error !== 'branch_already_exists') {
    throw new CodeChangeError(
      typeof prepared.payload.error === 'string' ? prepared.payload.error : `action_${prepared.response.status}`,
      prepared.response.status,
      prepared.payload,
    );
  }

  const [currentBranch, currentBase] = await Promise.all([
    branchHead(source, invoke, core),
    defaultBranchHead(source, invoke, core),
  ]);
  if (currentBranch !== core.expectedBaseSha) {
    throw new CodeChangeError('branch_head_changed', 409, { currentBranch, expected: core.expectedBaseSha });
  }
  if (currentBase.sha !== core.expectedBaseSha) {
    throw new CodeChangeError('base_head_changed', 409, { currentBase: currentBase.sha, expected: core.expectedBaseSha });
  }
  const guidance = await targetGuidance(source, invoke, core, currentBranch);
  const open = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/pulls?state=open&head=${encodeURIComponent(`trvny:${core.branch}`)}&per_page=10`,
  );
  if (Array.isArray(open) && open.length) {
    throw new CodeChangeError('pull_request_already_exists', 409);
  }
  return {
    ok: true,
    recovered: true,
    repository: { name: core.repository, defaultBranch: currentBase.defaultBranch, baseSha: core.expectedBaseSha },
    branch: { name: core.branch, sha: currentBranch, created: false },
    agentGuidance: guidance,
  };
}

async function investigationContext(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
): Promise<JsonObject> {
  const investigation = await invokePayload(source, invoke, INVESTIGATE_PATH, {
    repository: core.repository,
    terms: core.investigationTerms,
    maxFiles: 6,
    ref,
    includeHistory: true,
    ...(core.path ? { path: core.path } : {}),
    ...(core.language ? { language: core.language } : {}),
  });
  const dependencies = await Promise.all(
    core.targetPaths.map(async (path) => {
      const response = await handleDependencyGraphAction(
        internalRequest(source, DEPENDENCY_GRAPH_PATH, {
          repository: core.repository,
          path,
          ref,
          maxCallers: 8,
        }),
        invoke,
      );
      if (!response) return { path, ok: false, error: 'dependency_route_missing' };
      const payload = await responseObject(response);
      return response.ok && payload.ok === true
        ? { path, ok: true, data: payload }
        : { path, ok: false, status: response.status, error: payload.error ?? 'dependency_lookup_failed' };
    }),
  );
  return { investigation: investigation.payload, dependencies };
}

async function targetedVerification(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
): Promise<JsonObject> {
  const response = await handleTargetedTestsAction(
    internalRequest(source, TARGETED_TESTS_PATH, {
      repository: core.repository,
      targetPaths: core.targetPaths,
      ref,
    }),
    invoke,
  );
  if (!response) throw new CodeChangeError('targeted_test_route_missing', 502);
  const payload = await responseObject(response);
  if (!response.ok || payload.ok !== true) {
    throw new CodeChangeError(
      typeof payload.error === 'string' ? payload.error : 'targeted_test_discovery_failed',
      response.status,
      payload,
    );
  }
  return payload;
}

function verificationCommands(plan: JsonObject): Array<{ cwd: string; command: string }> {
  if (!Array.isArray(plan.recommendedCommands)) return [];
  return plan.recommendedCommands
    .filter(isObject)
    .map((entry) => ({ cwd: stringValue(entry.cwd) ?? '.', command: stringValue(entry.command) ?? '' }))
    .filter((entry) => Boolean(entry.command));
}

function verificationEvidenceMissing(plan: JsonObject, results: JsonObject[]): string[] {
  const passed = new Set(
    results
      .filter((result) => result.status === 'passed')
      .map((result) => `${stringValue(result.cwd) ?? '.'}\n${stringValue(result.command) ?? ''}`),
  );
  return verificationCommands(plan)
    .filter((expected) => !passed.has(`${expected.cwd}\n${expected.command}`))
    .map((expected) => `${expected.cwd}: ${expected.command}`);
}

export function reviewGateBlockers(
  snapshot: ReviewGateSnapshot,
  expectedHeadSha: string,
  expectedBaseRef: string,
): string[] {
  const blockers: string[] = [];
  if (snapshot.state !== 'open') blockers.push(`state:${snapshot.state}`);
  if (snapshot.baseRef !== expectedBaseRef) blockers.push(`base_changed:${snapshot.baseRef}`);
  if (snapshot.draft) blockers.push('draft');
  if (snapshot.headSha.toLowerCase() !== expectedHeadSha.toLowerCase()) blockers.push('head_changed');
  if (snapshot.mergeable !== true) blockers.push(snapshot.mergeable === false ? 'not_mergeable' : 'mergeability_unknown');
  if (snapshot.ciState !== 'success') blockers.push(`ci:${snapshot.ciState}`);
  if (snapshot.unresolvedThreads > 0) blockers.push(`unresolved_threads:${snapshot.unresolvedThreads}`);
  if (snapshot.activeChangeRequests > 0) blockers.push(`changes_requested:${snapshot.activeChangeRequests}`);
  return blockers;
}

function finalizeSnapshot(inspection: JsonObject): ReviewGateSnapshot {
  const data = isObject(inspection.data) ? inspection.data : null;
  const raw = data && isObject(data.finalizeSnapshot) ? data.finalizeSnapshot : null;
  const pullRequest = data && isObject(data.pullRequest) ? data.pullRequest : null;
  const baseRef = pullRequest ? stringValue(pullRequest.baseRef) : null;
  if (
    !raw ||
    !baseRef ||
    typeof raw.state !== 'string' ||
    typeof raw.draft !== 'boolean' ||
    typeof raw.headSha !== 'string' ||
    !SHA_RE.test(raw.headSha) ||
    (raw.mergeable !== true && raw.mergeable !== false && raw.mergeable !== null) ||
    (raw.ciState !== 'none' && raw.ciState !== 'pending' && raw.ciState !== 'failure' && raw.ciState !== 'success') ||
    typeof raw.unresolvedThreads !== 'number' ||
    typeof raw.activeChangeRequests !== 'number'
  ) {
    throw new CodeChangeError('invalid_finalize_snapshot', 502);
  }
  return { ...raw, baseRef } as unknown as ReviewGateSnapshot;
}

async function inspect(source: Request, invoke: Invoke, core: CoreInput, pullRequestNumber: number): Promise<JsonObject> {
  return (await invokePayload(source, invoke, INSPECT_PR_PATH, {
    repository: core.repository,
    pullRequestNumber,
  })).payload;
}

async function verifyRecoveredCommit(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  previousHead: string,
  currentHead: string,
  edit: EditAction,
): Promise<boolean> {
  const commit = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/commits/${currentHead}`,
  );
  if (!isObject(commit) || !Array.isArray(commit.parents) || commit.parents.length !== 1) return false;
  const parent = isObject(commit.parents[0]) ? stringValue(commit.parents[0].sha) : null;
  const message = isObject(commit.commit) ? stringValue(commit.commit.message) : null;
  if (parent?.toLowerCase() !== previousHead || message !== edit.message) return false;
  const files = Array.isArray(commit.files) ? commit.files : [];
  const changed = files
    .map((file) => (isObject(file) ? stringValue(file.filename) : null))
    .filter((path): path is string => Boolean(path));
  if (changed.length !== edit.files.length || new Set(changed).size !== changed.length) return false;
  if (!edit.files.every((file) => changed.includes(file.path))) return false;

  for (const file of edit.files) {
    const { response, payload } = await invokePayload(
      source,
      invoke,
      READ_PATH,
      { path: `/repos/${repoPath(core.repository)}/contents/${contentPath(file.path)}?ref=${currentHead}` },
      true,
    );
    if (file.content === null) {
      if (response.status !== 404) return false;
      continue;
    }
    if (!response.ok || payload.ok !== true || decodeContent(payload.data) !== file.content) return false;
  }
  return true;
}

async function commitEdit(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  progress: Progress,
  edit: EditAction,
): Promise<string> {
  const current = await branchHead(source, invoke, core);
  if (current !== progress.branchHead) {
    if (await verifyRecoveredCommit(source, invoke, core, progress.branchHead, current, edit)) return current;
    throw new CodeChangeError('branch_head_changed', 409, { expected: progress.branchHead, current });
  }
  const { payload } = await invokePayload(source, invoke, COMMIT_FILES_PATH, {
    repository: core.repository,
    branch: core.branch,
    expectedHeadSha: progress.branchHead,
    message: edit.message,
    files: edit.files,
  });
  const sha = stringValue(payload.sha);
  if (!sha || !SHA_RE.test(sha)) throw new CodeChangeError('invalid_commit_response', 502);
  return sha.toLowerCase();
}

async function findOpenPullRequest(source: Request, invoke: Invoke, core: CoreInput): Promise<JsonObject | null> {
  const raw = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/pulls?state=open&head=${encodeURIComponent(`trvny:${core.branch}`)}&per_page=10`,
  );
  const matches = Array.isArray(raw) ? raw.filter(isObject) : [];
  if (matches.length > 1) throw new CodeChangeError('ambiguous_pull_request', 409);
  return matches[0] ?? null;
}

function pullRequestProgress(raw: JsonObject, expectedHeadSha: string): PullRequestProgress {
  const head = isObject(raw.head) ? raw.head : {};
  const number = numberValue(raw.number);
  const sha = stringValue(head.sha);
  if (!number || !sha || sha.toLowerCase() !== expectedHeadSha) {
    throw new CodeChangeError('pull_request_head_changed', 409);
  }
  return { number, headSha: sha.toLowerCase(), htmlUrl: stringValue(raw.html_url) };
}

async function createOrRecoverPullRequest(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  progress: Progress,
  input: NonNullable<VerificationAction['pullRequest']>,
): Promise<PullRequestProgress> {
  const existing = await findOpenPullRequest(source, invoke, core);
  if (existing) {
    const recovered = pullRequestProgress(existing, progress.branchHead);
    if (stringValue(existing.title) !== input.title) throw new CodeChangeError('pull_request_metadata_mismatch', 409);
    return recovered;
  }
  const { payload } = await invokePayload(source, invoke, CREATE_PR_PATH, {
    repository: core.repository,
    title: input.title,
    head: core.branch,
    base: progress.defaultBranch,
    body: input.body,
    draft: false,
  });
  const raw = isObject(payload.data) ? payload.data : null;
  if (!raw) throw new CodeChangeError('invalid_pull_request_response', 502);
  return pullRequestProgress(raw, progress.branchHead);
}

async function mergedPullRequest(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  number: number,
): Promise<JsonObject | null> {
  const raw = await readData(source, invoke, `/repos/${repoPath(core.repository)}/pulls/${number}`);
  if (!isObject(raw)) throw new CodeChangeError('invalid_pull_request_response', 502);
  return typeof raw.merged_at === 'string' ? raw : null;
}

async function cleanup(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  pullRequest: PullRequestProgress,
): Promise<JsonObject> {
  const { payload } = await invokePayload(source, invoke, CLEANUP_BRANCH_PATH, {
    repository: core.repository,
    pullRequestNumber: pullRequest.number,
    branch: core.branch,
    expectedHeadSha: pullRequest.headSha,
  }, true);
  return payload;
}

async function complete(
  env: AutopilotCheckpointEnv,
  core: CoreInput,
  inputHash: string,
  body: JsonObject,
): Promise<Response> {
  const stored = await checkpointCall(env, core.operationId, '/complete', {
    inputHash,
    status: 200,
    body,
  });
  if (!stored.response.ok) throw new CodeChangeError('checkpoint_completion_failed', 502);
  return json(body);
}

async function pause(
  env: AutopilotCheckpointEnv,
  core: CoreInput,
  inputHash: string,
  progress: Progress,
  body: JsonObject,
  status = 200,
): Promise<Response> {
  const stored = await checkpointCall(env, core.operationId, '/progress', { inputHash, progress });
  if (!stored.response.ok) throw new CodeChangeError('checkpoint_progress_failed', 502);
  return json({ ...body, operation: { id: core.operationId, status: 'paused', resumable: true } }, status);
}

async function editingResponse(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  progress: Progress,
): Promise<JsonObject> {
  const guidance = await targetGuidance(source, invoke, core, progress.branchHead);
  const investigated = await investigationContext(source, invoke, core, progress.branchHead);
  return {
    ok: true,
    stage: 'editing',
    goal: core.goal,
    branch: { name: core.branch, headSha: progress.branchHead },
    agentGuidance: guidance,
    ...investigated,
    nextAction: {
      type: 'edit',
      note: 'Submit complete contents only for declared targetPaths. Semantic code choices stay with the model.',
    },
  };
}

async function initialProgress(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
): Promise<{ progress: Progress; body: JsonObject }> {
  const prepared = await preparationContext(source, invoke, core);
  const repositoryData = isObject(prepared.repository) ? prepared.repository : {};
  const defaultBranch = stringValue(repositoryData.defaultBranch);
  if (!defaultBranch) throw new CodeChangeError('invalid_prepare_change_response', 502);
  const progress: Progress = {
    stage: 'editing',
    defaultBranch,
    branchHead: core.expectedBaseSha,
    revision: 0,
  };
  const investigated = await investigationContext(source, invoke, core, progress.branchHead);
  return {
    progress,
    body: {
      ok: true,
      stage: 'editing',
      goal: core.goal,
      branch: { name: core.branch, headSha: progress.branchHead },
      preparation: prepared,
      ...investigated,
      nextAction: {
        type: 'edit',
        note: 'Submit complete contents only for declared targetPaths. Semantic code choices stay with the model.',
      },
    },
  };
}

async function run(
  request: Request,
  env: AutopilotCheckpointEnv,
  invoke: Invoke,
): Promise<Response> {
  const parsed = await parseInput(request);
  const { core, inputHash } = parsed;
  const claim = await checkpointCall(env, core.operationId, '/claim', {
    operationId: core.operationId,
    inputHash,
  });
  if (!claim.response.ok) return new Response(claim.response.body, claim.response);
  if (claim.payload.state === 'complete' && isObject(claim.payload.result)) {
    const result = claim.payload.result;
    return json(isObject(result.body) ? result.body : { ok: false, error: 'invalid_checkpoint_result' },
      typeof result.status === 'number' ? result.status : 200);
  }

  let progress = isObject(claim.payload.progress) ? claim.payload.progress as Progress : null;
  try {
    if (!progress) {
      const started = await initialProgress(request, invoke, core);
      progress = started.progress;
      return pause(env, core, inputHash, progress, started.body);
    }

    const submitted = parsed.action;
    if (submitted?.type === 'edit') {
      if (progress.stage !== 'editing' && progress.stage !== 'waiting_ci_review') {
        throw new CodeChangeError('edit_not_allowed_in_stage', 409, { stage: progress.stage });
      }
      const newHead = await commitEdit(request, invoke, core, progress, submitted);
      const verificationPlan = await targetedVerification(request, invoke, core, newHead);
      const next: Progress = {
        ...progress,
        stage: 'verifying',
        branchHead: newHead,
        revision: progress.revision + 1,
        ...(progress.pullRequest
          ? { pullRequest: { ...progress.pullRequest, headSha: newHead } }
          : {}),
      };
      delete next.verification;
      return pause(env, core, inputHash, next, {
        ok: true,
        stage: 'verifying',
        revision: next.revision,
        headSha: newHead,
        verificationPlan,
        finalGate: 'Normal repository CI on the final PR head remains mandatory.',
        nextAction: { type: 'verification', allowedStatuses: ['passed', 'failed', 'unavailable'] },
      });
    }

    if (submitted?.type === 'verification') {
      if (progress.stage !== 'verifying') {
        throw new CodeChangeError('verification_not_allowed_in_stage', 409, { stage: progress.stage });
      }
      const verificationPlan = await targetedVerification(request, invoke, core, progress.branchHead);
      if (submitted.status === 'passed') {
        const missing = verificationEvidenceMissing(verificationPlan, submitted.results ?? []);
        if (missing.length) {
          throw new CodeChangeError('verification_evidence_incomplete', 409, { missing });
        }
      }
      if (submitted.status === 'failed') {
        const next: Progress = { ...progress, stage: 'editing' };
        return pause(env, core, inputHash, next, {
          ok: false,
          stage: 'editing',
          verification: { status: 'failed', results: submitted.results ?? [] },
          verificationPlan,
          nextAction: { type: 'edit', note: 'Fix the failed targeted verification on the same guarded branch.' },
        });
      }

      const verification = {
        status: submitted.status as 'passed' | 'unavailable',
        ...(submitted.reason ? { reason: submitted.reason } : {}),
      };
      if (progress.pullRequest) {
        const next: Progress = { ...progress, stage: 'waiting_ci_review', verification };
        const inspection = await inspect(request, invoke, core, progress.pullRequest.number);
        return pause(env, core, inputHash, next, {
          ok: true,
          stage: 'waiting_ci_review',
          verification,
          pullRequest: progress.pullRequest,
          inspection: inspection.data ?? null,
          nextAction: { type: 'review', note: 'Wait for final-head CI/review, fix actionable findings, then submit semantic review completion.' },
        });
      }
      if (!submitted.pullRequest) throw new CodeChangeError('pull_request_required');
      const pullRequest = await createOrRecoverPullRequest(request, invoke, core, progress, submitted.pullRequest);
      const next: Progress = { ...progress, stage: 'waiting_ci_review', verification, pullRequest };
      const inspection = await inspect(request, invoke, core, pullRequest.number);
      return pause(env, core, inputHash, next, {
        ok: true,
        stage: 'waiting_ci_review',
        verification,
        pullRequest,
        inspection: inspection.data ?? null,
        nextAction: { type: 'review', note: 'Wait for final-head CI/review, fix actionable findings, then submit semantic review completion.' },
      });
    }

    if (submitted?.type === 'review') {
      if (progress.stage !== 'waiting_ci_review' || !progress.pullRequest) {
        throw new CodeChangeError('review_not_allowed_in_stage', 409, { stage: progress.stage });
      }
      if (submitted.reviewedHeadSha !== progress.branchHead) {
        throw new CodeChangeError('reviewed_head_changed', 409, {
          reviewed: submitted.reviewedHeadSha,
          expected: progress.branchHead,
        });
      }
      const alreadyMerged = await mergedPullRequest(request, invoke, core, progress.pullRequest.number);
      if (alreadyMerged) {
        const mergedHead = isObject(alreadyMerged.head) ? stringValue(alreadyMerged.head.sha) : null;
        const mergedBase = isObject(alreadyMerged.base) ? stringValue(alreadyMerged.base.ref) : null;
        if (!mergedHead || mergedHead.toLowerCase() !== progress.branchHead) {
          throw new CodeChangeError('pull_request_head_changed', 409, {
            expected: progress.branchHead,
            current: mergedHead,
          });
        }
        if (mergedBase !== progress.defaultBranch) {
          throw new CodeChangeError('pull_request_base_changed', 409, {
            expected: progress.defaultBranch,
            current: mergedBase,
          });
        }
        const cleanupResult = await cleanup(request, invoke, core, progress.pullRequest);
        return complete(env, core, inputHash, {
          ok: true,
          stage: 'merged',
          recovered: true,
          pullRequest: progress.pullRequest,
          mergedAt: stringValue(alreadyMerged.merged_at),
          cleanup: cleanupResult,
        });
      }

      const inspection = await inspect(request, invoke, core, progress.pullRequest.number);
      const snapshot = finalizeSnapshot(inspection);
      const blockers = reviewGateBlockers(snapshot, progress.branchHead, progress.defaultBranch);
      if (blockers.length) {
        return pause(env, core, inputHash, progress, {
          ok: false,
          stage: 'waiting_ci_review',
          blockers,
          inspection: inspection.data ?? null,
          nextAction: blockers.some((blocker) => blocker.startsWith('ci:failure'))
            ? { type: 'edit', note: 'Diagnose the failed CI before finalization.' }
            : { type: 'review', note: 'Wait for or resolve final-head CI/review blockers.' },
        }, 409);
      }

      const finalized = await invokePayload(request, invoke, FINALIZE_PR_PATH, {
        repository: core.repository,
        pullRequestNumber: progress.pullRequest.number,
        expectedHeadSha: progress.branchHead,
        mergeMethod: submitted.mergeMethod,
        expectedBaseRef: progress.defaultBranch,
      }, true);
      if (!finalized.response.ok || finalized.payload.merged !== true) {
        const merged = await mergedPullRequest(request, invoke, core, progress.pullRequest.number);
        if (!merged) {
          return pause(env, core, inputHash, progress, {
            ok: false,
            stage: 'waiting_ci_review',
            error: finalized.payload.error ?? 'finalize_failed',
            blockers: finalized.payload.blockers ?? [],
          }, finalized.response.status || 409);
        }
      }
      const merged = await mergedPullRequest(request, invoke, core, progress.pullRequest.number);
      if (!merged) throw new CodeChangeError('merge_not_confirmed', 502);
      const cleanupResult = await cleanup(request, invoke, core, progress.pullRequest);
      return complete(env, core, inputHash, {
        ok: true,
        stage: 'merged',
        pullRequest: progress.pullRequest,
        mergeMethod: submitted.mergeMethod,
        merge: finalized.payload,
        mergedAt: stringValue(merged.merged_at),
        cleanup: cleanupResult,
      });
    }

    if (progress.stage === 'editing') {
      return pause(env, core, inputHash, progress, await editingResponse(request, invoke, core, progress));
    }
    if (progress.stage === 'verifying') {
      const verificationPlan = await targetedVerification(request, invoke, core, progress.branchHead);
      return pause(env, core, inputHash, progress, {
        ok: true,
        stage: 'verifying',
        revision: progress.revision,
        headSha: progress.branchHead,
        verificationPlan,
        finalGate: 'Normal repository CI on the final PR head remains mandatory.',
        nextAction: { type: 'verification', allowedStatuses: ['passed', 'failed', 'unavailable'] },
      });
    }
    if (!progress.pullRequest) throw new CodeChangeError('missing_pull_request_progress', 500);
    const inspection = await inspect(request, invoke, core, progress.pullRequest.number);
    return pause(env, core, inputHash, progress, {
      ok: true,
      stage: 'waiting_ci_review',
      pullRequest: progress.pullRequest,
      verification: progress.verification ?? null,
      inspection: inspection.data ?? null,
      blockers: reviewGateBlockers(finalizeSnapshot(inspection), progress.branchHead, progress.defaultBranch),
      nextAction: { type: 'review', note: 'Fix actionable findings before marking semantic review complete.' },
    });
  } catch (error) {
    if (progress) {
      await checkpointCall(env, core.operationId, '/progress', { inputHash, progress }).catch(() => null);
    } else {
      await checkpointCall(env, core.operationId, '/uncertain', { inputHash }).catch(() => null);
    }
    throw error;
  }
}

function objectResponse(description: string): JsonObject {
  return {
    description,
    content: { 'application/json': { schema: { type: 'object', properties: {} } } },
  };
}

export function addCodeChangeAutopilotOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[CODE_CHANGE_AUTOPILOT_PATH] = {
    post: {
      operationId: 'implementCodeChange',
      summary: 'Run a resumable guarded code-change workflow',
      description:
        'Composes exact-base preparation, scoped guidance/investigation, model-authored edits, GPTomek commits, targeted verification, trvny-authored PR creation, final-head CI/review gates, merge and cleanup. Reuse operationId to resume.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: [
                'operationId', 'repository', 'goal', 'branch', 'expectedBaseSha',
                'targetPaths', 'investigationTerms',
              ],
              properties: {
                operationId: { type: 'string', pattern: '^op-[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$' },
                repository: { type: 'string', example: 'trvny/trvny' },
                goal: { type: 'string' },
                branch: { type: 'string' },
                expectedBaseSha: { type: 'string' },
                targetPaths: { type: 'array', minItems: 1, maxItems: MAX_TARGETS, items: { type: 'string' } },
                investigationTerms: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
                issueNumber: { type: 'integer', minimum: 1 },
                path: { type: 'string' },
                language: { type: 'string' },
                action: {
                  description: 'Stage submission. Omit to inspect or resume the current stage.',
                  oneOf: [
                    {
                      type: 'object',
                      required: ['type', 'message', 'files'],
                      properties: {
                        type: { type: 'string', enum: ['edit'] },
                        message: { type: 'string' },
                        files: {
                          type: 'array',
                          minItems: 1,
                          maxItems: MAX_FILES,
                          items: {
                            type: 'object',
                            required: ['path', 'content'],
                            properties: {
                              path: { type: 'string' },
                              content: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                            },
                          },
                        },
                      },
                    },
                    {
                      type: 'object',
                      required: ['type', 'status'],
                      properties: {
                        type: { type: 'string', enum: ['verification'] },
                        status: { type: 'string', enum: ['passed', 'failed', 'unavailable'] },
                        reason: { type: 'string' },
                        results: { type: 'array', items: { type: 'object', properties: {} } },
                        pullRequest: {
                          type: 'object',
                          required: ['title'],
                          properties: { title: { type: 'string' }, body: { type: 'string' } },
                        },
                      },
                    },
                    {
                      type: 'object',
                      required: ['type', 'reviewedHeadSha', 'semanticReviewComplete'],
                      properties: {
                        type: { type: 'string', enum: ['review'] },
                        reviewedHeadSha: { type: 'string' },
                        semanticReviewComplete: { type: 'boolean', enum: [true] },
                        mergeMethod: { type: 'string', enum: ['squash', 'merge', 'rebase'] },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
      responses: {
        '200': objectResponse('Code-change workflow stage'),
        '400': objectResponse('Invalid request'),
        '409': objectResponse('State or finalization conflict'),
        '502': objectResponse('Dependent action failed'),
      },
    },
  };
}

export async function handleCodeChangeAutopilotAction(
  request: Request,
  env: AutopilotCheckpointEnv,
  invoke: Invoke,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== CODE_CHANGE_AUTOPILOT_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await run(request, env, invoke);
  } catch (error) {
    if (error instanceof CodeChangeError) {
      return json({ ok: false, error: error.code, ...error.details }, error.status);
    }
    console.error(JSON.stringify({
      codeChangeAutopilot: 'failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    }));
    return json({ ok: false, error: 'code_change_internal_error' }, 500);
  }
}
