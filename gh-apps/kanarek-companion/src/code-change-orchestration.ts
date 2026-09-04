import {
  autopilotInputHash,
  checkpointCall,
  operationIdAllowed,
  type AutopilotCheckpointEnv,
} from './autopilot-checkpoint.ts';
import { loadAgentGuidance } from './agents-guidance.ts';
import { resolveGitTreeEntries, type GitTreeEntry } from './git-tree.ts';
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
const MAX_RECOVERED_COMMITS = 50;
const MAX_REFACTOR_MOVES = 6;
const MAX_REFACTOR_REFERENCE_FILES = MAX_FILES;
const GPTOMEK_COMMIT_NAME = 'GPTomek';
const GPTOMEK_COMMIT_EMAIL = '314538226+gptomek[bot]@users.noreply.github.com';
const OPERATION_TRAILER = 'GPTomek-Operation';
const INPUT_HASH_TRAILER = 'GPTomek-Input-Hash';

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
  refactor?: RefactorPlan;
};

type RefactorMove = { fromPath: string; toPath: string };
type RefactorPlan = { moves: RefactorMove[]; referenceTerms: string[] };
type RefactorReferenceTermSnapshot = {
  term: string;
  indexedCount: number | null;
  incomplete: boolean;
  matchingPaths: string[];
};
type RefactorSnapshot = {
  ref: string;
  moveFiles: TargetFileSnapshot[];
  references: RefactorReferenceTermSnapshot[];
};

type EditFile = { path: string; content: string | null };
type EditAction = { type: 'edit'; headSha: string; revision: number; message: string; files: EditFile[] };
type VerificationResult = {
  status: 'passed' | 'failed';
  cwd: string;
  command: string;
};
type VerificationAction = {
  type: 'verification';
  status: 'passed' | 'failed' | 'unavailable';
  headSha: string;
  revision: number;
  reason?: string;
  results?: VerificationResult[];
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
  refactor?: {
    allowedPaths: string[];
    before: RefactorSnapshot;
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

function refactorPlan(value: unknown, scope: string[]): RefactorPlan | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || Object.keys(value).some((key) => key !== 'moves' && key !== 'referenceTerms')) {
    throw new CodeChangeError('invalid_refactor');
  }
  if (!Array.isArray(value.moves) || value.moves.length < 1 || value.moves.length > MAX_REFACTOR_MOVES) {
    throw new CodeChangeError('invalid_refactor_moves');
  }
  const allowed = new Set(scope);
  const used = new Set<string>();
  const moves = value.moves.map((entry) => {
    if (!isObject(entry) || !validPath(entry.fromPath) || !validPath(entry.toPath)) {
      throw new CodeChangeError('invalid_refactor_moves');
    }
    if (entry.fromPath === entry.toPath || !allowed.has(entry.fromPath) || !allowed.has(entry.toPath)) {
      throw new CodeChangeError('refactor_outside_declared_scope', 409);
    }
    if (used.has(entry.fromPath) || used.has(entry.toPath)) {
      throw new CodeChangeError('overlapping_refactor_moves', 409);
    }
    used.add(entry.fromPath);
    used.add(entry.toPath);
    return { fromPath: entry.fromPath, toPath: entry.toPath };
  });
  if (!Array.isArray(value.referenceTerms) || value.referenceTerms.length < 1 || value.referenceTerms.length > 6) {
    throw new CodeChangeError('invalid_refactor_reference_terms');
  }
  const referenceTerms = value.referenceTerms.map((term) => {
    if (typeof term !== 'string' || term.length < 2 || term.length > 80 || !/^[A-Za-z0-9_./@+-]+$/.test(term)) {
      throw new CodeChangeError('invalid_refactor_reference_terms');
    }
    return term;
  });
  if (new Set(referenceTerms.map((term) => term.toLowerCase())).size !== referenceTerms.length) {
    throw new CodeChangeError('invalid_refactor_reference_terms');
  }
  return { moves, referenceTerms };
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

export function operationCommitMessage(
  message: string,
  operationId: string,
  inputHash: string,
): string {
  return `${message}\n\n${OPERATION_TRAILER}: ${operationId}\n${INPUT_HASH_TRAILER}: ${inputHash}`;
}

export function commitProvenanceMatches(
  message: string | null,
  operationId: string,
  inputHash: string,
): boolean {
  if (!message) return false;
  const trailer = `\n\n${OPERATION_TRAILER}: ${operationId}\n${INPUT_HASH_TRAILER}: ${inputHash}`;
  return message.endsWith(trailer);
}

export function recoveredChangedPathsAllowed(changed: string[], submitted: string[]): boolean {
  if (new Set(changed).size !== changed.length) return false;
  const allowed = new Set(submitted);
  return changed.every((path) => allowed.has(path));
}

function editFiles(value: unknown): EditFile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_FILES) {
    throw new CodeChangeError('invalid_files');
  }
  const files = value.map((entry) => {
    if (!isObject(entry) || !validPath(entry.path)) {
      throw new CodeChangeError('invalid_file_path');
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

function action(value: unknown): Action | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value) || typeof value.type !== 'string') throw new CodeChangeError('invalid_action');
  if (value.type === 'edit') {
    const headSha = expectedSha(value.headSha, 'edit_head_sha');
    const revision = numberValue(value.revision);
    if (revision === null || revision < 0) throw new CodeChangeError('invalid_edit_revision');
    return {
      type: 'edit',
      headSha,
      revision,
      message: requiredText(value.message, 'commit_message', 1_000),
      files: editFiles(value.files),
    };
  }
  if (value.type === 'verification') {
    if (value.status !== 'passed' && value.status !== 'failed' && value.status !== 'unavailable') {
      throw new CodeChangeError('invalid_verification_status');
    }
    const headSha = expectedSha(value.headSha, 'verification_head_sha');
    const revision = numberValue(value.revision);
    if (revision === null || revision < 1) throw new CodeChangeError('invalid_verification_revision');
    const reason = value.reason === undefined ? undefined : requiredText(value.reason, 'verification_reason', 2_000);
    if (value.status === 'unavailable' && !reason) throw new CodeChangeError('verification_reason_required');
    let results: VerificationResult[] | undefined;
    if (value.results !== undefined) {
      if (!Array.isArray(value.results) || value.results.length > 30) {
        throw new CodeChangeError('invalid_verification_results');
      }
      results = value.results.map((entry) => {
        if (!isObject(entry) || (entry.status !== 'passed' && entry.status !== 'failed')) {
          throw new CodeChangeError('invalid_verification_results');
        }
        return {
          status: entry.status,
          cwd: requiredText(entry.cwd, 'verification_cwd', 1_000),
          command: requiredText(entry.command, 'verification_command', 8_000),
        };
      });
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
      headSha,
      revision,
      ...(reason ? { reason } : {}),
      ...(results ? { results } : {}),
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
    'investigationTerms', 'issueNumber', 'path', 'language', 'refactor', 'action',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) {
    throw new CodeChangeError('invalid_code_change_request');
  }
  if (!operationIdAllowed(raw.operationId)) throw new CodeChangeError('invalid_operation_id');
  const declaredTargets = targetPaths(raw.targetPaths);
  const refactor = refactorPlan(raw.refactor, declaredTargets);
  const core: CoreInput = {
    operationId: String(raw.operationId),
    repository: repository(raw.repository),
    goal: requiredText(raw.goal, 'goal', 4_000),
    branch: branch(raw.branch),
    expectedBaseSha: expectedSha(raw.expectedBaseSha, 'expected_base_sha'),
    targetPaths: declaredTargets,
    investigationTerms: terms(raw.investigationTerms),
    issueNumber: optionalIssue(raw.issueNumber),
    path: optionalFilter(raw.path, 'path'),
    language: optionalFilter(raw.language, 'language'),
    ...(refactor ? { refactor } : {}),
  };
  const coreHash = { ...core } as JsonObject;
  delete coreHash.operationId;
  return {
    core,
    action: action(raw.action),
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

export function decodeContent(value: unknown): string | null {
  if (!isObject(value) || value.encoding !== 'base64' || typeof value.content !== 'string') return null;
  try {
    const binary = atob(value.content.replace(/\s/g, ''));
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

async function targetGuidance(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
  paths = core.targetPaths,
): Promise<unknown> {
  return loadAgentGuidance(paths, ref, async (path, pinnedRef) => {
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

async function treeEntriesAtRef(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
  paths: string[],
): Promise<Map<string, GitTreeEntry>> {
  const rawCommit = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/commits/${encodeURIComponent(ref)}`,
  );
  const commit = isObject(rawCommit) && isObject(rawCommit.commit) ? rawCommit.commit : null;
  const tree = commit && isObject(commit.tree) ? commit.tree : null;
  const treeSha = tree ? stringValue(tree.sha) : null;
  if (!treeSha || !SHA_RE.test(treeSha)) throw new CodeChangeError('invalid_commit_tree_response', 502);

  return resolveGitTreeEntries(treeSha, paths, async (sha) => {
    const raw = await readData(source, invoke, `/repos/${repoPath(core.repository)}/git/trees/${sha}`);
    if (!isObject(raw) || raw.truncated === true || !Array.isArray(raw.tree)) {
      throw new CodeChangeError('git_tree_not_readable', 502);
    }
    return raw.tree.flatMap((value): GitTreeEntry[] => {
      if (!isObject(value)) return [];
      const path = stringValue(value.path);
      const mode = stringValue(value.mode);
      const type = stringValue(value.type);
      const entrySha = stringValue(value.sha);
      return path && mode && type && entrySha && SHA_RE.test(entrySha)
        ? [{ path, mode, type, sha: entrySha.toLowerCase() }]
        : [];
    });
  });
}

type TargetFileSnapshot = {
  path: string;
  exists: boolean;
  content: string | null;
  mode?: string;
};

async function fileSnapshotsAtRef(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
  paths: string[],
): Promise<TargetFileSnapshot[]> {
  const entries = await treeEntriesAtRef(source, invoke, core, ref, paths);
  return Promise.all(paths.map(async (path) => {
    const entry = entries.get(path);
    if (!entry) return { path, exists: false, content: null };
    if (
      entry.type !== 'blob' ||
      (entry.mode !== '100644' && entry.mode !== '100755' && entry.mode !== '120000')
    ) {
      throw new CodeChangeError('unsupported_target_file_mode', 409, { path, mode: entry.mode, type: entry.type });
    }
    const raw = await readData(
      source,
      invoke,
      `/repos/${repoPath(core.repository)}/git/blobs/${entry.sha}`,
    );
    const content = decodeContent(raw);
    if (content === null) throw new CodeChangeError('target_file_not_utf8', 415, { path });
    if (content.length > MAX_FILE_CONTENT) {
      throw new CodeChangeError('file_content_too_large', 413, { path });
    }
    return { path, exists: true, content, mode: entry.mode };
  }));
}

async function targetFileSnapshots(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
  paths = core.targetPaths,
): Promise<TargetFileSnapshot[]> {
  return fileSnapshotsAtRef(source, invoke, core, ref, paths);
}

export function refactorEditBlockers(
  plan: RefactorPlan,
  files: EditFile[],
  initialMove: boolean,
): string[] {
  const submitted = new Map(files.map((file) => [file.path, file.content]));
  const blockers: string[] = [];
  for (const move of plan.moves) {
    if (initialMove) {
      if (!submitted.has(move.fromPath) || submitted.get(move.fromPath) !== null) {
        blockers.push(`source_delete_required:${move.fromPath}`);
      }
      if (!submitted.has(move.toPath) || submitted.get(move.toPath) === null) {
        blockers.push(`destination_write_required:${move.toPath}`);
      }
      continue;
    }
    if (submitted.has(move.fromPath) && submitted.get(move.fromPath) !== null) {
      blockers.push(`source_recreated:${move.fromPath}`);
    }
    if (submitted.has(move.toPath) && submitted.get(move.toPath) === null) {
      blockers.push(`destination_deleted:${move.toPath}`);
    }
  }
  return blockers;
}

export function refactorPreflightBlockers(
  plan: RefactorPlan,
  snapshots: Array<{ path: string; exists: boolean }>,
): string[] {
  const files = new Map(snapshots.map((snapshot) => [snapshot.path, snapshot.exists]));
  const blockers: string[] = [];
  for (const move of plan.moves) {
    if (files.get(move.fromPath) !== true) blockers.push(`source_missing:${move.fromPath}`);
    if (files.get(move.toPath) === true) blockers.push(`destination_exists:${move.toPath}`);
  }
  return blockers;
}

export function refactorVerificationBlockers(
  plan: RefactorPlan,
  snapshots: Array<{ path: string; exists: boolean }>,
  references: RefactorReferenceTermSnapshot[],
): string[] {
  const files = new Map(snapshots.map((snapshot) => [snapshot.path, snapshot.exists]));
  const blockers: string[] = [];
  for (const move of plan.moves) {
    if (files.get(move.fromPath) === true) blockers.push(`source_still_exists:${move.fromPath}`);
    if (files.get(move.toPath) !== true) blockers.push(`destination_missing:${move.toPath}`);
  }
  for (const reference of references) {
    if (reference.incomplete) blockers.push(`reference_scan_incomplete:${reference.term}`);
    for (const path of reference.matchingPaths) blockers.push(`stale_reference:${reference.term}:${path}`);
  }
  return blockers;
}

function refactorSearchQuery(core: CoreInput, term: string): string {
  return [
    term,
    `repo:${core.repository}`,
    ...(core.path ? [`path:${core.path}`] : []),
    ...(core.language ? [`language:${core.language}`] : []),
  ].join(' ');
}

async function refactorSnapshotAtRef(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
): Promise<RefactorSnapshot> {
  if (!core.refactor) throw new CodeChangeError('missing_refactor_plan', 500);
  const searches = await Promise.all(core.refactor.referenceTerms.map(async (term) => {
    const raw = await readData(
      source,
      invoke,
      `/search/code?q=${encodeURIComponent(refactorSearchQuery(core, term))}&per_page=${MAX_REFACTOR_REFERENCE_FILES}`,
    );
    if (!isObject(raw) || !Array.isArray(raw.items)) {
      throw new CodeChangeError('invalid_refactor_reference_search', 502);
    }
    const indexedCount = numberValue(raw.total_count);
    const paths = raw.items.flatMap((item) => {
      if (!isObject(item)) return [];
      const path = stringValue(item.path);
      return path && validPath(path) ? [path] : [];
    });
    return {
      term,
      indexedCount,
      incomplete: raw.incomplete_results === true || indexedCount === null || indexedCount > paths.length,
      paths,
    };
  }));

  const candidates = [...core.targetPaths];
  const candidateSet = new Set(candidates);
  const droppedTerms = new Set<string>();
  for (const search of searches) {
    for (const path of search.paths) {
      if (candidateSet.has(path)) continue;
      if (candidates.length >= MAX_REFACTOR_REFERENCE_FILES) {
        droppedTerms.add(search.term);
        continue;
      }
      candidateSet.add(path);
      candidates.push(path);
    }
  }
  const files = await fileSnapshotsAtRef(source, invoke, core, ref, candidates);
  const references = searches.map((search): RefactorReferenceTermSnapshot => ({
    term: search.term,
    indexedCount: search.indexedCount,
    incomplete: search.incomplete || droppedTerms.has(search.term),
    matchingPaths: files
      .filter((file) => file.exists && typeof file.content === 'string' && file.content.includes(search.term))
      .map((file) => file.path),
  }));
  const movePaths = new Set(core.refactor.moves.flatMap((move) => [move.fromPath, move.toPath]));
  return {
    ref,
    moveFiles: files.filter((file) => movePaths.has(file.path)),
    references,
  };
}

export function refactorAllowedPaths(core: CoreInput, snapshot: RefactorSnapshot): string[] {
  const paths = [...core.targetPaths];
  const seen = new Set(paths);
  for (const reference of snapshot.references) {
    for (const path of reference.matchingPaths) {
      if (seen.has(path)) continue;
      if (paths.length >= MAX_FILES) throw new CodeChangeError('refactor_scope_too_large', 409);
      seen.add(path);
      paths.push(path);
    }
  }
  return paths;
}

async function refactorBeforeSnapshot(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
): Promise<RefactorSnapshot> {
  const snapshot = await refactorSnapshotAtRef(source, invoke, core, core.expectedBaseSha);
  if (!core.refactor) throw new CodeChangeError('missing_refactor_plan', 500);
  const blockers = [
    ...refactorPreflightBlockers(core.refactor, snapshot.moveFiles),
    ...snapshot.references
      .filter((reference) => reference.incomplete)
      .map((reference) => `reference_scan_incomplete:${reference.term}`),
  ];
  if (blockers.length) throw new CodeChangeError('refactor_precondition_failed', 409, { blockers });
  refactorAllowedPaths(core, snapshot);
  return snapshot;
}

async function refactorAfterSnapshot(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
): Promise<RefactorSnapshot & { blockers: string[] }> {
  const snapshot = await refactorSnapshotAtRef(source, invoke, core, ref);
  if (!core.refactor) throw new CodeChangeError('missing_refactor_plan', 500);
  return {
    ...snapshot,
    blockers: refactorVerificationBlockers(core.refactor, snapshot.moveFiles, snapshot.references),
  };
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

type RecoveredBranch = {
  revision: number;
  pullRequest?: PullRequestProgress;
};

function commitIdentityMatches(value: unknown): boolean {
  if (!isObject(value)) return false;
  return stringValue(value.name) === GPTOMEK_COMMIT_NAME && stringValue(value.email) === GPTOMEK_COMMIT_EMAIL;
}

async function recoverEvolvedBranch(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  inputHash: string,
  currentBranch: string,
  defaultBranch: string,
): Promise<RecoveredBranch> {
  const compare = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/compare/${core.expectedBaseSha}...${currentBranch}`,
  );
  if (!isObject(compare) || compare.status !== 'ahead') {
    throw new CodeChangeError('branch_not_recoverable', 409);
  }
  const aheadBy = numberValue(compare.ahead_by);
  const commits = Array.isArray(compare.commits) ? compare.commits : [];
  if (
    aheadBy === null ||
    aheadBy < 1 ||
    aheadBy > MAX_RECOVERED_COMMITS ||
    commits.length !== aheadBy
  ) {
    throw new CodeChangeError('branch_history_not_recoverable', 409);
  }

  let expectedParent = core.expectedBaseSha;
  for (const value of commits) {
    if (!isObject(value) || !Array.isArray(value.parents) || value.parents.length !== 1) {
      throw new CodeChangeError('branch_history_not_recoverable', 409);
    }
    const sha = stringValue(value.sha);
    const parent = isObject(value.parents[0]) ? stringValue(value.parents[0].sha) : null;
    const commit = isObject(value.commit) ? value.commit : null;
    if (
      !sha ||
      !SHA_RE.test(sha) ||
      !parent ||
      parent.toLowerCase() !== expectedParent ||
      !commit ||
      !commitIdentityMatches(commit.author) ||
      !commitIdentityMatches(commit.committer) ||
      !commitProvenanceMatches(stringValue(commit.message), core.operationId, inputHash)
    ) {
      throw new CodeChangeError('branch_history_not_recoverable', 409);
    }
    expectedParent = sha.toLowerCase();
  }
  if (expectedParent !== currentBranch) {
    throw new CodeChangeError('branch_history_not_recoverable', 409);
  }

  const allowed = new Set(
    core.refactor
      ? refactorAllowedPaths(core, await refactorBeforeSnapshot(source, invoke, core))
      : core.targetPaths,
  );
  const files = Array.isArray(compare.files) ? compare.files : [];
  if (
    files.some((value) => !isObject(value) || !stringValue(value.filename) || !allowed.has(String(value.filename)))
  ) {
    throw new CodeChangeError('branch_scope_changed', 409);
  }

  const rawPullRequests = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/pulls?state=all&head=${encodeURIComponent(`trvny:${core.branch}`)}&per_page=10`,
  );
  const pullRequests = Array.isArray(rawPullRequests) ? rawPullRequests.filter(isObject) : [];
  if (pullRequests.length > 1) throw new CodeChangeError('ambiguous_pull_request', 409);
  if (!pullRequests.length) return { revision: aheadBy };

  const raw = pullRequests[0];
  const head = isObject(raw.head) ? raw.head : {};
  const base = isObject(raw.base) ? raw.base : {};
  if (stringValue(raw.state) !== 'open' || typeof raw.merged_at === 'string') {
    throw new CodeChangeError('pull_request_not_open', 409);
  }
  if (stringValue(head.ref) !== core.branch) {
    throw new CodeChangeError('pull_request_branch_changed', 409);
  }
  if (stringValue(base.ref) !== defaultBranch) {
    throw new CodeChangeError('pull_request_base_changed', 409);
  }
  return {
    revision: aheadBy,
    pullRequest: pullRequestProgress(raw, currentBranch),
  };
}

async function preparationContext(source: Request, invoke: Invoke, core: CoreInput, inputHash: string): Promise<JsonObject> {
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
  const guidance = await targetGuidance(source, invoke, core, currentBranch);

  if (currentBranch === core.expectedBaseSha) {
    if (currentBase.sha !== core.expectedBaseSha) {
      throw new CodeChangeError('base_head_changed', 409, { currentBase: currentBase.sha, expected: core.expectedBaseSha });
    }
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
      branch: { name: core.branch, sha: currentBranch, created: false, revision: 0 },
      agentGuidance: guidance,
    };
  }

  const recovered = await recoverEvolvedBranch(
    source,
    invoke,
    core,
    inputHash,
    currentBranch,
    currentBase.defaultBranch,
  );
  return {
    ok: true,
    recovered: true,
    recoveredEvolved: true,
    repository: { name: core.repository, defaultBranch: currentBase.defaultBranch, baseSha: core.expectedBaseSha },
    branch: { name: core.branch, sha: currentBranch, created: false, revision: recovered.revision },
    ...(recovered.pullRequest ? { pullRequest: recovered.pullRequest } : {}),
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
  paths = core.targetPaths,
): Promise<JsonObject> {
  const response = await handleTargetedTestsAction(
    internalRequest(source, TARGETED_TESTS_PATH, {
      repository: core.repository,
      targetPaths: paths,
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

function verificationEvidenceMissing(plan: JsonObject, results: VerificationResult[]): string[] {
  const passed = new Set(
    results
      .filter((result) => result.status === 'passed')
      .map((result) => `${result.cwd}\n${result.command}`),
  );
  return verificationCommands(plan)
    .filter((expected) => !passed.has(`${expected.cwd}\n${expected.command}`))
    .map((expected) => `${expected.cwd}: ${expected.command}`);
}

function verificationNextAction(progress: Progress): JsonObject {
  return {
    type: 'verification',
    headSha: progress.branchHead,
    revision: progress.revision,
    allowedStatuses: ['passed', 'failed', 'unavailable'],
  };
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
  inputHash: string,
  previousHead: string,
  currentHead: string,
  edit: EditAction,
  modeOverrides?: Map<string, string>,
): Promise<boolean> {
  const commit = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/commits/${currentHead}`,
  );
  if (!isObject(commit) || !Array.isArray(commit.parents) || commit.parents.length !== 1) return false;
  const parent = isObject(commit.parents[0]) ? stringValue(commit.parents[0].sha) : null;
  const message = isObject(commit.commit) ? stringValue(commit.commit.message) : null;
  if (
    parent?.toLowerCase() !== previousHead ||
    message !== operationCommitMessage(edit.message, core.operationId, inputHash)
  ) return false;
  const files = Array.isArray(commit.files) ? commit.files : [];
  const changed = files
    .map((file) => (isObject(file) ? stringValue(file.filename) : null))
    .filter((path): path is string => Boolean(path));
  if (!recoveredChangedPathsAllowed(changed, edit.files.map((file) => file.path))) return false;

  const snapshots = await fileSnapshotsAtRef(
    source,
    invoke,
    core,
    currentHead,
    edit.files.map((file) => file.path),
  );
  const byPath = new Map(snapshots.map((snapshot) => [snapshot.path, snapshot]));
  return edit.files.every((file) => {
    const snapshot = byPath.get(file.path);
    if (!snapshot) return false;
    if (file.content === null) return snapshot.exists === false;
    if (snapshot.exists !== true || snapshot.content !== file.content) return false;
    const expectedMode = modeOverrides?.get(file.path);
    return !expectedMode || snapshot.mode === expectedMode;
  });
}

async function commitEdit(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  inputHash: string,
  progress: Progress,
  edit: EditAction,
  modeOverrides?: Map<string, string>,
): Promise<string> {
  const current = await branchHead(source, invoke, core);
  if (current !== progress.branchHead) {
    if (await verifyRecoveredCommit(source, invoke, core, inputHash, progress.branchHead, current, edit, modeOverrides)) {
      return current;
    }
    throw new CodeChangeError('branch_head_changed', 409, { expected: progress.branchHead, current });
  }
  const { payload } = await invokePayload(source, invoke, COMMIT_FILES_PATH, {
    repository: core.repository,
    branch: core.branch,
    expectedHeadSha: progress.branchHead,
    message: operationCommitMessage(edit.message, core.operationId, inputHash),
    files: edit.files.map((file) => ({
      ...file,
      ...(modeOverrides?.get(file.path) ? { mode: modeOverrides.get(file.path) } : {}),
    })),
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

function validateMergedPullRequest(raw: JsonObject, progress: Progress): void {
  const head = isObject(raw.head) ? raw.head : {};
  const base = isObject(raw.base) ? raw.base : {};
  const headSha = stringValue(head.sha);
  const baseRef = stringValue(base.ref);
  if (!headSha || headSha.toLowerCase() !== progress.branchHead) {
    throw new CodeChangeError('pull_request_head_changed', 409, { expected: progress.branchHead, current: headSha });
  }
  if (baseRef !== progress.defaultBranch) {
    throw new CodeChangeError('pull_request_base_changed', 409, { expected: progress.defaultBranch, current: baseRef });
  }
}

async function assertPullRequestEditable(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  progress: Progress,
): Promise<void> {
  if (!progress.pullRequest) throw new CodeChangeError('missing_pull_request_progress', 500);
  const raw = await readData(source, invoke, `/repos/${repoPath(core.repository)}/pulls/${progress.pullRequest.number}`);
  if (!isObject(raw)) throw new CodeChangeError('invalid_pull_request_response', 502);
  const head = isObject(raw.head) ? raw.head : {};
  const base = isObject(raw.base) ? raw.base : {};
  const state = stringValue(raw.state);
  const headRef = stringValue(head.ref);
  const headSha = stringValue(head.sha);
  const baseRef = stringValue(base.ref);
  if (state !== 'open' || typeof raw.merged_at === 'string') throw new CodeChangeError('pull_request_not_open', 409, { state });
  if (headRef !== core.branch) throw new CodeChangeError('pull_request_branch_changed', 409, { expected: core.branch, current: headRef });
  if (!headSha || headSha.toLowerCase() !== progress.branchHead) throw new CodeChangeError('pull_request_head_changed', 409, { expected: progress.branchHead, current: headSha });
  if (baseRef !== progress.defaultBranch) throw new CodeChangeError('pull_request_base_changed', 409, { expected: progress.defaultBranch, current: baseRef });
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
  const editPaths = progress.refactor?.allowedPaths ?? core.targetPaths;
  const [guidance, investigated, targetFiles, refactor] = await Promise.all([
    targetGuidance(source, invoke, core, progress.branchHead, editPaths),
    investigationContext(source, invoke, core, progress.branchHead),
    targetFileSnapshots(source, invoke, core, progress.branchHead, editPaths),
    core.refactor
      ? (progress.revision === 0
          ? Promise.resolve(progress.refactor?.before ?? await refactorBeforeSnapshot(source, invoke, core))
          : refactorAfterSnapshot(source, invoke, core, progress.branchHead))
      : Promise.resolve(null),
  ]);
  return {
    ok: true,
    stage: 'editing',
    goal: core.goal,
    branch: { name: core.branch, headSha: progress.branchHead },
    agentGuidance: guidance,
    targetFiles,
    ...(refactor ? { refactor: { plan: core.refactor, snapshot: refactor, allowedPaths: editPaths } } : {}),
    ...investigated,
    nextAction: {
      type: 'edit',
      headSha: progress.branchHead,
      revision: progress.revision,
      note: core.refactor
        ? 'Submit the declared move as source deletion plus destination full contents and update stale references within the returned refactor scope.'
        : 'Use targetFiles as the authoritative full snapshot. Submit complete replacement contents only for declared targetPaths; missing targets are marked exists:false.',
    },
  };
}

async function initialProgress(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  inputHash: string,
): Promise<{ progress: Progress; body: JsonObject }> {
  const prepared = await preparationContext(source, invoke, core, inputHash);
  const repositoryData = isObject(prepared.repository) ? prepared.repository : {};
  const branchData = isObject(prepared.branch) ? prepared.branch : {};
  const defaultBranch = stringValue(repositoryData.defaultBranch);
  const branchSha = stringValue(branchData.sha);
  const revision = numberValue(branchData.revision) ?? 0;
  if (!defaultBranch || !branchSha || !SHA_RE.test(branchSha) || revision < 0) {
    throw new CodeChangeError('invalid_prepare_change_response', 502);
  }

  let pullRequest: PullRequestProgress | undefined;
  if (isObject(prepared.pullRequest)) {
    const number = numberValue(prepared.pullRequest.number);
    const headSha = stringValue(prepared.pullRequest.headSha);
    if (!number || !headSha || headSha.toLowerCase() !== branchSha.toLowerCase()) {
      throw new CodeChangeError('invalid_prepare_change_response', 502);
    }
    pullRequest = {
      number,
      headSha: headSha.toLowerCase(),
      htmlUrl: stringValue(prepared.pullRequest.htmlUrl),
    };
  }

  const refactorBefore = core.refactor
    ? await refactorBeforeSnapshot(source, invoke, core)
    : null;
  const progress: Progress = {
    stage: revision > 0 ? 'verifying' : 'editing',
    defaultBranch,
    branchHead: branchSha.toLowerCase(),
    revision,
    ...(pullRequest ? { pullRequest } : {}),
    ...(refactorBefore
      ? { refactor: { allowedPaths: refactorAllowedPaths(core, refactorBefore), before: refactorBefore } }
      : {}),
  };

  if (revision > 0) {
    const refactorVerification = core.refactor
      ? await refactorAfterSnapshot(source, invoke, core, progress.branchHead)
      : null;
    if (refactorVerification?.blockers.length) {
      const editingProgress: Progress = { ...progress, stage: 'editing' };
      return {
        progress: editingProgress,
        body: {
          ok: false,
          recovered: true,
          stage: 'editing',
          revision,
          headSha: progress.branchHead,
          preparation: prepared,
          refactor: { plan: core.refactor, snapshot: refactorVerification, allowedPaths: progress.refactor?.allowedPaths ?? core.targetPaths },
          nextAction: {
            type: 'edit',
            headSha: progress.branchHead,
            revision,
            note: 'Finish the refactor by removing stale references without recreating moved source paths.',
          },
        },
      };
    }
    const verificationPlan = await targetedVerification(
      source, invoke, core, progress.branchHead, progress.refactor?.allowedPaths ?? core.targetPaths,
    );
    return {
      progress,
      body: {
        ok: true,
        recovered: true,
        stage: 'verifying',
        revision,
        headSha: progress.branchHead,
        preparation: prepared,
        ...(refactorVerification ? { refactor: { plan: core.refactor, snapshot: refactorVerification, allowedPaths: progress.refactor?.allowedPaths ?? core.targetPaths } } : {}),
        verificationPlan,
        finalGate: 'Normal repository CI on the final PR head remains mandatory.',
        nextAction: verificationNextAction(progress),
      },
    };
  }

  const editPaths = progress.refactor?.allowedPaths ?? core.targetPaths;
  const [guidance, investigated, targetFiles] = await Promise.all([
    targetGuidance(source, invoke, core, progress.branchHead, editPaths),
    investigationContext(source, invoke, core, progress.branchHead),
    targetFileSnapshots(source, invoke, core, progress.branchHead, editPaths),
  ]);
  return {
    progress,
    body: {
      ok: true,
      stage: 'editing',
      goal: core.goal,
      branch: { name: core.branch, headSha: progress.branchHead },
      preparation: prepared,
      agentGuidance: guidance,
      targetFiles,
      ...(progress.refactor ? { refactor: { plan: core.refactor, before: progress.refactor.before, allowedPaths: editPaths } } : {}),
      ...investigated,
      nextAction: {
        type: 'edit',
        headSha: progress.branchHead,
        revision: progress.revision,
        note: core.refactor
          ? 'Submit each move as source deletion plus destination full contents and update every declared reference term.'
          : 'Use targetFiles as the authoritative full snapshot. Submit complete replacement contents only for declared targetPaths; missing targets are marked exists:false.',
      },
    },
  };
}

function refactorModeOverrides(plan: RefactorPlan, snapshot: RefactorSnapshot): Map<string, string> {
  const byPath = new Map(snapshot.moveFiles.map((file) => [file.path, file]));
  const modes = new Map<string, string>();
  for (const move of plan.moves) {
    const source = byPath.get(move.fromPath);
    if (!source?.mode) throw new CodeChangeError('missing_refactor_source_mode', 502, { path: move.fromPath });
    modes.set(move.toPath, source.mode);
  }
  return modes;
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
      const started = await initialProgress(request, invoke, core, inputHash);
      progress = started.progress;
      return pause(env, core, inputHash, progress, started.body);
    }

    const submitted = parsed.action;
    if (submitted?.type === 'edit') {
    if (progress.stage !== 'editing' && progress.stage !== 'waiting_ci_review') {
      throw new CodeChangeError('edit_not_allowed_in_stage', 409, { stage: progress.stage });
    }
    if (submitted.headSha !== progress.branchHead || submitted.revision !== progress.revision) {
      throw new CodeChangeError('edit_revision_changed', 409, {
        expectedHeadSha: progress.branchHead,
        expectedRevision: progress.revision,
      });
    }
    const editScope = new Set(progress.refactor?.allowedPaths ?? core.targetPaths);
    if (submitted.files.some((file) => !editScope.has(file.path))) {
      throw new CodeChangeError('edit_outside_declared_scope', 409, {
        allowedPaths: [...editScope],
      });
    }
    let modeOverrides: Map<string, string> | undefined;
    if (core.refactor) {
      const initialMove = progress.revision === 0;
      const blockers = refactorEditBlockers(core.refactor, submitted.files, initialMove);
      if (blockers.length) throw new CodeChangeError('invalid_refactor_edit', 409, { blockers });
      if (initialMove) {
        modeOverrides = refactorModeOverrides(
          core.refactor,
          progress.refactor?.before ?? await refactorBeforeSnapshot(request, invoke, core),
        );
      }
    }

    let editProgress = progress;
    let recoveredEdit = false;
    if (progress.stage === 'waiting_ci_review') {
      if (!progress.pullRequest) throw new CodeChangeError('missing_pull_request_progress', 500);
      const current = await branchHead(request, invoke, core);
      if (current !== progress.branchHead) {
        if (!await verifyRecoveredCommit(request, invoke, core, inputHash, progress.branchHead, current, submitted, modeOverrides)) {
          throw new CodeChangeError('branch_head_changed', 409, { expected: progress.branchHead, current });
        }
        editProgress = {
          ...progress,
          branchHead: current,
          pullRequest: { ...progress.pullRequest, headSha: current },
        };
        recoveredEdit = true;
      }
      await assertPullRequestEditable(request, invoke, core, editProgress);
    }

    const previousHead = editProgress.branchHead;
    const newHead = recoveredEdit
      ? editProgress.branchHead
      : await commitEdit(request, invoke, core, inputHash, editProgress, submitted, modeOverrides);
    if (progress.stage === 'waiting_ci_review' && newHead !== previousHead) {
      editProgress = {
        ...editProgress,
        branchHead: newHead,
        pullRequest: editProgress.pullRequest
          ? { ...editProgress.pullRequest, headSha: newHead }
          : undefined,
      };
      await assertPullRequestEditable(request, invoke, core, editProgress);
    }

    const refactorVerification = core.refactor
      ? await refactorAfterSnapshot(request, invoke, core, newHead)
      : null;
    const nextRevision = progress.revision + 1;
    if (refactorVerification?.blockers.length) {
      const next: Progress = {
        ...editProgress,
        stage: 'editing',
        branchHead: newHead,
        revision: nextRevision,
        ...(editProgress.pullRequest
          ? { pullRequest: { ...editProgress.pullRequest, headSha: newHead } }
          : {}),
      };
      delete next.verification;
      return pause(env, core, inputHash, next, {
        ok: false,
        stage: 'editing',
        revision: next.revision,
        headSha: newHead,
        refactor: { plan: core.refactor, snapshot: refactorVerification, allowedPaths: progress.refactor?.allowedPaths ?? core.targetPaths },
        nextAction: {
          type: 'edit',
          headSha: newHead,
          revision: next.revision,
          note: 'Remove the reported stale references or incomplete move state before targeted verification.',
        },
      }, 409);
    }

    const verificationPlan = await targetedVerification(request, invoke, core, newHead, progress.refactor?.allowedPaths ?? core.targetPaths);
    const next: Progress = {
      ...editProgress,
      stage: 'verifying',
      branchHead: newHead,
      revision: nextRevision,
      ...(editProgress.pullRequest
        ? { pullRequest: { ...editProgress.pullRequest, headSha: newHead } }
        : {}),
    };
    delete next.verification;
    return pause(env, core, inputHash, next, {
      ok: true,
      stage: 'verifying',
      revision: next.revision,
      headSha: newHead,
      ...(refactorVerification ? { refactor: { plan: core.refactor, snapshot: refactorVerification, allowedPaths: progress.refactor?.allowedPaths ?? core.targetPaths } } : {}),
      verificationPlan,
      finalGate: 'Normal repository CI on the final PR head remains mandatory.',
      nextAction: verificationNextAction(next),
    });
  }

  if (submitted?.type === 'verification') {
      if (progress.stage !== 'verifying') {
        throw new CodeChangeError('verification_not_allowed_in_stage', 409, { stage: progress.stage });
      }
      if (submitted.headSha !== progress.branchHead || submitted.revision !== progress.revision) {
        throw new CodeChangeError('verification_revision_changed', 409, {
          expectedHeadSha: progress.branchHead,
          expectedRevision: progress.revision,
        });
      }
      const verificationPlan = await targetedVerification(request, invoke, core, progress.branchHead, progress.refactor?.allowedPaths ?? core.targetPaths);
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
          nextAction: { type: 'edit', headSha: progress.branchHead, revision: progress.revision, note: 'Fix the failed targeted verification on the same guarded branch.' },
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
        validateMergedPullRequest(alreadyMerged, progress);
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
            ? {
              type: 'edit',
              headSha: progress.branchHead,
              revision: progress.revision,
              note: 'Diagnose the failed CI before finalization.',
            }
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
      validateMergedPullRequest(merged, progress);
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
      const verificationPlan = await targetedVerification(request, invoke, core, progress.branchHead, progress.refactor?.allowedPaths ?? core.targetPaths);
      return pause(env, core, inputHash, progress, {
        ok: true,
        stage: 'verifying',
        revision: progress.revision,
        headSha: progress.branchHead,
        verificationPlan,
        finalGate: 'Normal repository CI on the final PR head remains mandatory.',
        nextAction: verificationNextAction(progress),
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
        'Composes exact-base preparation, scoped guidance/investigation, model-authored edits, optional guarded rename/move reference verification, GPTomek commits, targeted verification, trvny-authored PR creation, final-head CI/review gates, merge and cleanup. Reuse operationId to resume.',
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
                refactor: {
                  type: 'object',
                  required: ['moves', 'referenceTerms'],
                  description: 'Optional rename/move plan. Every source/destination must also be declared in targetPaths; exact-base reference matches are added to the bounded edit scope and must disappear before targeted verification.',
                  properties: {
                    moves: {
                      type: 'array',
                      minItems: 1,
                      maxItems: MAX_REFACTOR_MOVES,
                      items: {
                        type: 'object',
                        required: ['fromPath', 'toPath'],
                        properties: {
                          fromPath: { type: 'string' },
                          toPath: { type: 'string' },
                        },
                      },
                    },
                    referenceTerms: {
                      type: 'array',
                      minItems: 1,
                      maxItems: 6,
                      items: { type: 'string' },
                    },
                  },
                },
                action: {
                  description: 'Stage submission. Omit to inspect or resume the current stage.',
                  oneOf: [
                    {
                      type: 'object',
                      required: ['type', 'headSha', 'revision', 'message', 'files'],
                      properties: {
                        type: { type: 'string', enum: ['edit'] },
                        headSha: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' },
                        revision: { type: 'integer', minimum: 0 },
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
                      required: ['type', 'status', 'headSha', 'revision'],
                      properties: {
                        type: { type: 'string', enum: ['verification'] },
                        status: { type: 'string', enum: ['passed', 'failed', 'unavailable'] },
                        headSha: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' },
                        revision: { type: 'integer', minimum: 1 },
                        reason: { type: 'string' },
                        results: {
                          type: 'array',
                          maxItems: 30,
                          items: {
                            type: 'object',
                            required: ['status', 'cwd', 'command'],
                            properties: {
                              status: { type: 'string', enum: ['passed', 'failed'] },
                              cwd: { type: 'string' },
                              command: { type: 'string' },
                            },
                          },
                        },
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
