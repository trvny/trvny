import { autopilotInputHash } from './autopilot-checkpoint.ts';
import { CODE_HISTORY_PATH, handleCodeHistoryAction } from './code-history.ts';
import { resolveGitTreeEntries, type GitTreeEntry } from './git-tree.ts';
import {
  handleSymbolInvestigationAction,
  likelyTestPath,
  SYMBOL_INVESTIGATION_PATH,
  symbolOccurrences,
} from './symbol-investigation.ts';
import { handleTargetedTestsAction, TARGETED_TESTS_PATH } from './test-discovery.ts';

export const BUG_INVESTIGATION_PATH = '/gpt-actions/operator/bug-investigate';

const READ_PATH = '/gpt-actions/github/read';
const DIAGNOSE_RUN_PATH = '/gpt-actions/github/workflows/diagnose';
const CODE_CHANGE_PATH = '/gpt-actions/operator/code-change';
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_SOURCE_TEXT = 24_000;
const MAX_TARGETS = 6;
const MAX_GOAL = 4_000;
const MAX_TARGET_PATH_SEGMENTS = 32;
const MAX_FALLBACK_FILE_BYTES = 400_000;
const SOURCE_EXTENSIONS = new Set([
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'kt', 'java', 'py', 'go', 'rs', 'swift',
]);
const DEPENDENCY_PATH_SEGMENTS = new Set(['node_modules', 'vendor', '.venv', 'venv', '.gradle']);

type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;

type BugSource =
  | { kind: 'issue'; issueNumber: number }
  | { kind: 'workflow'; runId: number }
  | { kind: 'error'; errorText: string };

type Input = {
  repository: string;
  source: BugSource;
  ref?: string;
  hints: string[];
  path?: string;
  language?: string;
  maxSymbols: number;
  maxFiles: number;
};

type ResolvedSource = {
  kind: BugSource['kind'];
  id: string;
  text: string;
  label: string;
  url: string | null;
  suggestedRef: string | null;
  details: JsonObject;
};

type Snapshot = {
  defaultBranch: string;
  requestedRef: string;
  sha: string;
  baseSha: string;
};

export type BugHandoffIdentity = {
  repository: string;
  goal: string;
  evidenceSha: string;
  expectedBaseSha: string;
  targetPaths: string[];
  investigationTerms: string[];
  issueNumber?: number;
  path?: string;
  language?: string;
};

class BugInvestigationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'BugInvestigationError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new BugInvestigationError('repository_not_allowed', 403);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new BugInvestigationError(`invalid_${name}`);
  }
  return value;
}

function boundedInteger(value: unknown, name: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = positiveInteger(value, name);
  if (parsed > max) throw new BugInvestigationError(`invalid_${name}`);
  return parsed;
}

function refAllowed(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 200) return false;
  if (SHA_RE.test(value)) return true;
  if (
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.startsWith('-') ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    /[~^:?*\[\\\s]/.test(value)
  ) {
    return false;
  }
  return value.split('/').every((part) => part && part !== '.' && !part.endsWith('.lock'));
}

function optionalRef(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!refAllowed(value)) throw new BugInvestigationError('invalid_ref');
  return value;
}

export function bugFilterAllowed(value: unknown, name: 'path' | 'language'): value is string {
  if (typeof value !== 'string' || !value) return false;
  const max = name === 'language' ? 40 : 300;
  const pattern = name === 'path' ? /^[A-Za-z0-9_./-]+$/ : /^[A-Za-z0-9#+._-]+$/;
  if (value.length > max || !pattern.test(value)) return false;
  if (
    name === 'path' &&
    (value.startsWith('/') || value.endsWith('/') || value.includes('..') || value.includes('//'))
  ) {
    return false;
  }
  return true;
}

function optionalFilter(value: unknown, name: 'path' | 'language'): string | undefined {
  if (value === undefined) return undefined;
  if (!bugFilterAllowed(value, name)) throw new BugInvestigationError(`invalid_${name}`);
  return value;
}

function symbolAllowed(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.length <= 80 &&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
  );
}

function investigationTermAllowed(value: string): boolean {
  return value.length >= 2 && value.length <= 80 && /^[A-Za-z0-9_./@+-]+$/.test(value);
}

export function bugHandoffTerms(symbols: string[], targetPaths: string[]): string[] {
  const values = symbols.length ? symbols : targetPaths;
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of values) {
    if (!investigationTermAllowed(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(value);
    if (terms.length >= 6) break;
  }
  return terms;
}

function hintValues(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new BugInvestigationError('invalid_hints');
  const hints = value.map((entry) => {
    if (!symbolAllowed(entry)) throw new BugInvestigationError('invalid_hints');
    return entry;
  });
  return [...new Set(hints)];
}

function sourceInput(value: JsonObject): BugSource {
  const present = [value.issueNumber !== undefined, value.workflowRunId !== undefined, value.errorText !== undefined]
    .filter(Boolean).length;
  if (present !== 1) throw new BugInvestigationError('exactly_one_bug_source_required');
  if (value.issueNumber !== undefined) {
    return { kind: 'issue', issueNumber: positiveInteger(value.issueNumber, 'issue_number') };
  }
  if (value.workflowRunId !== undefined) {
    return { kind: 'workflow', runId: positiveInteger(value.workflowRunId, 'workflow_run_id') };
  }
  if (typeof value.errorText !== 'string' || value.errorText.trim().length < 3 || value.errorText.length > MAX_SOURCE_TEXT) {
    throw new BugInvestigationError('invalid_error_text');
  }
  return { kind: 'error', errorText: value.errorText.trim() };
}

async function inputObject(request: Request): Promise<Input> {
  const text = await request.clone().text();
  if (text.length > 40_000) throw new BugInvestigationError('payload_too_large', 413);
  let value: unknown = {};
  try {
    if (text.trim()) value = JSON.parse(text);
  } catch {
    throw new BugInvestigationError('invalid_json');
  }
  if (!isObject(value)) throw new BugInvestigationError('invalid_json_object');
  const allowed = new Set([
    'repository', 'issueNumber', 'workflowRunId', 'errorText', 'ref', 'hints',
    'path', 'language', 'maxSymbols', 'maxFiles',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new BugInvestigationError('invalid_bug_investigation_request');
  }
  return {
    repository: repository(value.repository),
    source: sourceInput(value),
    ref: optionalRef(value.ref),
    hints: hintValues(value.hints),
    path: optionalFilter(value.path, 'path'),
    language: optionalFilter(value.language, 'language'),
    maxSymbols: boundedInteger(value.maxSymbols, 'max_symbols', 4, 6),
    maxFiles: boundedInteger(value.maxFiles, 'max_files', 6, 10),
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
    throw new BugInvestigationError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new BugInvestigationError('invalid_action_response', 502);
  if (!response.ok || value.ok !== true) {
    throw new BugInvestigationError(
      typeof value.error === 'string' ? value.error : `action_${response.status}`,
      response.status,
    );
  }
  return value;
}

async function readData(source: Request, invoke: Invoke, path: string): Promise<unknown> {
  const payload = await responseObject(await invoke(internalRequest(source, READ_PATH, { path })));
  return payload.data;
}

function repoPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function contentPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactText(value: string, max = MAX_SOURCE_TEXT): string {
  const normalized = value.replace(/\r\n?/g, '\n').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 2)}…`;
}

function decodeSnapshotContent(value: unknown): string | null {
  if (!isObject(value) || value.encoding !== 'base64' || typeof value.content !== 'string') return null;
  const size = numberValue(value.size);
  if (size !== null && size > MAX_FALLBACK_FILE_BYTES) return null;
  try {
    const binary = atob(value.content.replace(/\s/g, ''));
    if (binary.length > MAX_FALLBACK_FILE_BYTES) return null;
    return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

const SYMBOL_STOP_WORDS = new Set([
  'Error', 'TypeError', 'ReferenceError', 'Exception', 'AssertionError', 'Traceback', 'Failure',
  'Failed', 'Unknown', 'Promise', 'Object', 'String', 'Number', 'Boolean', 'Array', 'Function',
  'undefined', 'null', 'true', 'false', 'async', 'await', 'return', 'throw', 'const', 'class',
]);

export function extractBugSymbols(text: string, hints: string[] = [], limit = 6): string[] {
  const candidates: string[] = [];
  const candidateKeys = new Set<string>();
  const stackRanges: Array<[number, number]> = [];
  const add = (value: string | undefined): void => {
    if (!value || !symbolAllowed(value) || SYMBOL_STOP_WORDS.has(value)) return;
    const key = value.toLowerCase();
    if (candidateKeys.has(key)) return;
    candidateKeys.add(key);
    candidates.push(value);
  };
  hints.forEach(add);

  const stack = /\bat\s+(?:async\s+)?(?:new\s+)?([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)/g;
  for (const match of text.matchAll(stack)) {
    const qualified = match[1];
    const parts = qualified.split('.');
    add(parts.at(-1));
    if (parts.length > 1) add(parts.at(-2));
    const frameStart = match.index ?? 0;
    const nameStart = frameStart + match[0].lastIndexOf(qualified);
    stackRanges.push([nameStart, nameStart + qualified.length]);
    if (candidates.length >= limit) return candidates.slice(0, limit);
  }

  const dotted = /\b([A-Za-z_$][A-Za-z0-9_$]*)\.([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
  for (const match of text.matchAll(dotted)) {
    const index = match.index ?? 0;
    if (stackRanges.some(([start, end]) => index >= start && index < end)) continue;
    if (SOURCE_EXTENSIONS.has(match[2].toLowerCase())) continue;
    add(match[2]);
    add(match[1]);
    if (candidates.length >= limit) return candidates.slice(0, limit);
  }

  const distinctive = /\b(?:[A-Z][A-Za-z0-9_$]{2,}|[a-z_$][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*)\b/g;
  for (const match of text.matchAll(distinctive)) {
    const index = match.index ?? 0;
    if (stackRanges.some(([start, end]) => index >= start && index < end)) continue;
    const suffix = text.slice(index + match[0].length).match(/^\.([A-Za-z0-9]+)/)?.[1];
    if (suffix && SOURCE_EXTENSIONS.has(suffix.toLowerCase())) continue;
    add(match[0]);
    if (candidates.length >= limit) break;
  }
  return candidates.slice(0, limit);
}

function dependencyPath(value: string): boolean {
  return value.split('/').some((part) => DEPENDENCY_PATH_SEGMENTS.has(part));
}

function validCandidatePath(value: string): boolean {
  return (
    value.length <= 600 &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.includes('..') &&
    !value.includes('//') &&
    value.split('/').length <= MAX_TARGET_PATH_SEGMENTS &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

export function extractBugPaths(text: string, limit = MAX_TARGETS): string[] {
  const result: string[] = [];
  const pattern = /(?:[A-Za-z0-9_.@+-]+\/)*[A-Za-z0-9_.@+-]+\.(?:[cm]?[jt]sx?|kt|java|py|go|rs|swift)\b/g;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const preceding = index > 0 ? text[index - 1] : '';
    if (preceding === '/' || preceding === '\\') continue;
    const path = match[0].replace(/^\.\//, '');
    if (!validCandidatePath(path) || dependencyPath(path) || result.includes(path)) continue;
    result.push(path);
    if (result.length >= limit) break;
  }
  return result;
}

export function bugInvestigationFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export async function bugHandoffFingerprint(value: BugHandoffIdentity): Promise<string> {
  return autopilotInputHash(value as unknown as JsonObject);
}

async function resolveIssue(source: Request, invoke: Invoke, repositoryName: string, issueNumber: number): Promise<ResolvedSource> {
  const raw = await readData(source, invoke, `/repos/${repoPath(repositoryName)}/issues/${issueNumber}`);
  if (!isObject(raw)) throw new BugInvestigationError('invalid_issue_response', 502);
  const title = stringValue(raw.title) ?? `Issue #${issueNumber}`;
  const body = stringValue(raw.body) ?? '';
  return {
    kind: 'issue',
    id: String(issueNumber),
    text: compactText(`${title}\n\n${body}`),
    label: `Issue #${issueNumber}: ${title}`,
    url: stringValue(raw.html_url),
    suggestedRef: null,
    details: {
      number: numberValue(raw.number),
      title,
      state: stringValue(raw.state),
      labels: Array.isArray(raw.labels)
        ? raw.labels.slice(0, 12).map((label) => isObject(label) ? stringValue(label.name) : null).filter(Boolean)
        : [],
    },
  };
}

export function workflowEvidenceText(payload: JsonObject): string {
  const logs = Array.isArray(payload.logExcerpts) ? payload.logExcerpts.filter(isObject) : [];
  const excerpts = logs
    .map((entry) => stringValue(entry.excerpt))
    .filter((value): value is string => Boolean(value));
  if (excerpts.length) return compactText(excerpts.join('\n\n'));

  const names: string[] = [];
  const failingJobs = Array.isArray(payload.failingJobs) ? payload.failingJobs.filter(isObject) : [];
  for (const job of failingJobs) {
    const jobName = stringValue(job.name);
    if (jobName) names.push(jobName);
    const steps = Array.isArray(job.failedSteps) ? job.failedSteps.filter(isObject) : [];
    for (const step of steps) {
      const stepName = stringValue(step.name);
      if (stepName) names.push(stepName);
    }
  }
  return compactText(names.join('\n'));
}

async function resolveWorkflow(source: Request, invoke: Invoke, repositoryName: string, runId: number): Promise<ResolvedSource> {
  const payload = await responseObject(
    await invoke(internalRequest(source, DIAGNOSE_RUN_PATH, { repository: repositoryName, runId })),
  );
  const run = isObject(payload.run) ? payload.run : {};
  const headSha = stringValue(run.headSha);
  return {
    kind: 'workflow',
    id: String(runId),
    text: workflowEvidenceText(payload),
    label: `Workflow run ${runId}${stringValue(run.name) ? `: ${String(run.name)}` : ''}`,
    url: stringValue(run.htmlUrl),
    suggestedRef: headSha && SHA_RE.test(headSha) ? headSha.toLowerCase() : null,
    details: {
      run,
      failingJobs: Array.isArray(payload.failingJobs) ? payload.failingJobs : [],
      logExcerpts: Array.isArray(payload.logExcerpts) ? payload.logExcerpts : [],
    },
  };
}

async function resolveSource(source: Request, invoke: Invoke, input: Input): Promise<ResolvedSource> {
  if (input.source.kind === 'issue') {
    return resolveIssue(source, invoke, input.repository, input.source.issueNumber);
  }
  if (input.source.kind === 'workflow') {
    return resolveWorkflow(source, invoke, input.repository, input.source.runId);
  }
  const fingerprint = bugInvestigationFingerprint(input.source.errorText);
  return {
    kind: 'error',
    id: fingerprint,
    text: compactText(input.source.errorText),
    label: `Error report ${fingerprint}`,
    url: null,
    suggestedRef: null,
    details: {},
  };
}

async function resolveSnapshot(
  source: Request,
  invoke: Invoke,
  repositoryName: string,
  requestedRef?: string,
): Promise<Snapshot> {
  const repo = repoPath(repositoryName);
  const metadata = await readData(source, invoke, `/repos/${repo}`);
  if (!isObject(metadata) || typeof metadata.default_branch !== 'string') {
    throw new BugInvestigationError('invalid_repository_response', 502);
  }
  const defaultBranch = metadata.default_branch;
  const target = requestedRef ?? defaultBranch;
  const commit = await readData(source, invoke, `/repos/${repo}/commits/${encodeURIComponent(target)}`);
  if (!isObject(commit) || typeof commit.sha !== 'string' || !SHA_RE.test(commit.sha)) {
    throw new BugInvestigationError('invalid_ref_response', 502);
  }
  const evidenceSha = commit.sha.toLowerCase();
  let baseSha = evidenceSha;
  if (target !== defaultBranch) {
    const baseCommit = await readData(
      source,
      invoke,
      `/repos/${repo}/commits/${encodeURIComponent(defaultBranch)}`,
    );
    if (!isObject(baseCommit) || typeof baseCommit.sha !== 'string' || !SHA_RE.test(baseCommit.sha)) {
      throw new BugInvestigationError('invalid_default_branch_response', 502);
    }
    baseSha = baseCommit.sha.toLowerCase();
  }
  return {
    defaultBranch,
    requestedRef: target,
    sha: evidenceSha,
    baseSha,
  };
}

export async function existingTargetPaths(
  source: Request,
  invoke: Invoke,
  repositoryName: string,
  ref: string,
  candidates: string[],
): Promise<string[]> {
  const paths = [...new Set(candidates)].filter((path) => validCandidatePath(path) && !dependencyPath(path));
  if (!paths.length) return [];
  const repo = repoPath(repositoryName);
  const rawCommit = await readData(source, invoke, `/repos/${repo}/commits/${encodeURIComponent(ref)}`);
  const commit = isObject(rawCommit) && isObject(rawCommit.commit) ? rawCommit.commit : null;
  const tree = commit && isObject(commit.tree) ? commit.tree : null;
  const treeSha = tree ? stringValue(tree.sha) : null;
  if (!treeSha || !SHA_RE.test(treeSha)) throw new BugInvestigationError('invalid_commit_tree_response', 502);

  const entries = await resolveGitTreeEntries(treeSha, paths, async (sha) => {
    const raw = await readData(source, invoke, `/repos/${repo}/git/trees/${sha}`);
    if (!isObject(raw) || raw.truncated === true || !Array.isArray(raw.tree)) {
      throw new BugInvestigationError('git_tree_not_readable', 502);
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
  return paths.filter((path) => entries.get(path)?.type === 'blob');
}

function investigationHasEvidence(value: JsonObject): boolean {
  return ['definitions', 'imports', 'implementations', 'references', 'tests']
    .some((key) => Array.isArray(value[key]) && (value[key] as unknown[]).length > 0);
}

function pathMatchesFilter(path: string, filter?: string): boolean {
  if (!filter) return true;
  return path === filter || path.startsWith(`${filter}/`);
}

async function snapshotFallbackInvestigations(
  source: Request,
  invoke: Invoke,
  input: Input,
  snapshot: Snapshot,
  symbols: string[],
  investigations: JsonObject[],
): Promise<JsonObject[]> {
  if (snapshot.requestedRef === snapshot.defaultBranch || investigations.every(investigationHasEvidence)) {
    return investigations;
  }
  const repo = repoPath(input.repository);
  const compare = await readData(
    source,
    invoke,
    `/repos/${repo}/compare/${encodeURIComponent(snapshot.defaultBranch)}...${snapshot.sha}`,
  );
  if (!isObject(compare) || !Array.isArray(compare.files)) return investigations;
  const paths = compare.files
    .filter(isObject)
    .filter((entry) => stringValue(entry.status) !== 'removed')
    .map((entry) => stringValue(entry.filename))
    .filter((path): path is string => Boolean(path))
    .filter((path) => validCandidatePath(path) && !dependencyPath(path) && pathMatchesFilter(path, input.path))
    .slice(0, Math.min(40, input.maxFiles * 4));
  const files = await Promise.all(paths.map(async (path) => {
    const raw = await readData(
      source,
      invoke,
      `/repos/${repo}/contents/${contentPath(path)}?ref=${encodeURIComponent(snapshot.sha)}`,
    ).catch((error) => {
      if (error instanceof BugInvestigationError && error.status === 404) return null;
      throw error;
    });
    const content = raw ? decodeSnapshotContent(raw) : null;
    return content === null ? null : { path, content, testFile: likelyTestPath(path) };
  }));
  const available = files.filter((file): file is NonNullable<typeof file> => file !== null);

  return investigations.map((investigation, index) => {
    if (investigationHasEvidence(investigation)) return investigation;
    const symbol = symbols[index];
    if (!symbol) return investigation;
    const matches = available.flatMap((file) =>
      symbolOccurrences(file.content, symbol).map((occurrence) => ({
        path: file.path,
        testFile: file.testFile,
        line: occurrence.line,
        kind: occurrence.kind,
        confidence: occurrence.confidence,
        text: occurrence.text,
        context: occurrence.context,
      })),
    );
    if (!matches.length) return investigation;
    const definitions = matches.filter((item) => item.kind === 'definition');
    const imports = matches.filter((item) => item.kind === 'import');
    const implementations = matches.filter((item) => item.kind === 'implementation');
    const references = matches.filter((item) => item.kind === 'reference');
    const tests = matches.filter((item) => item.testFile);
    return {
      ok: true,
      symbol,
      snapshotFallback: true,
      definitions,
      imports,
      implementations,
      references,
      tests,
      files: available.filter((file) => matches.some((item) => item.path === file.path)).map((file) => ({
        path: file.path,
        testFile: file.testFile,
        contentAvailable: true,
      })),
    };
  });
}

async function childAction(
  request: Request,
  pathname: string,
  body: JsonObject,
  handler: (request: Request) => Promise<Response | null>,
): Promise<JsonObject> {
  try {
    const response = await handler(internalRequest(request, pathname, body));
    if (!response) return { ok: false, error: 'action_not_handled' };
    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      return { ok: false, error: 'invalid_action_response', status: response.status };
    }
    if (!isObject(payload)) return { ok: false, error: 'invalid_action_response', status: response.status };
    if (!response.ok || payload.ok !== true) {
      return {
        ok: false,
        error: typeof payload.error === 'string' ? payload.error : `action_${response.status}`,
        status: response.status,
      };
    }
    return payload;
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message.slice(0, 300) : 'action_failed',
    };
  }
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function collectTargetPaths(
  verifiedStackPaths: string[],
  hintedTarget: string | null,
  investigations: JsonObject[],
): { paths: string[]; symbolByPath: Map<string, string> } {
  const scores = new Map<string, number>();
  const symbolByPath = new Map<string, string>();
  const add = (path: unknown, score: number, symbol?: string): void => {
    if (typeof path !== 'string' || !validCandidatePath(path) || dependencyPath(path)) return;
    scores.set(path, Math.max(scores.get(path) ?? 0, score));
    if (symbol && !symbolByPath.has(path)) symbolByPath.set(path, symbol);
  };
  if (hintedTarget) add(hintedTarget, 130);
  verifiedStackPaths.forEach((path) => add(path, 120));
  for (const investigation of investigations) {
    if (investigation.ok !== true) continue;
    const symbol = stringValue(investigation.symbol) ?? undefined;
    objectArray(investigation.definitions).forEach((item) => add(item.path, item.testFile === true ? 45 : 100, symbol));
    objectArray(investigation.implementations).forEach((item) => add(item.path, item.testFile === true ? 40 : 80, symbol));
    objectArray(investigation.references).forEach((item) => add(item.path, item.testFile === true ? 35 : 55, symbol));
    objectArray(investigation.tests).forEach((item) => add(item.path, 30, symbol));
  }
  const paths = [...scores.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_TARGETS)
    .map(([path]) => path);
  return { paths, symbolByPath };
}

export function buildBugGoal(label: string, text: string): string {
  return compactText(
    `Investigate and fix this bug using the pinned evidence. Preserve unrelated behavior and add or update the smallest regression coverage that proves the fix.\n\nSource: ${label}\n${text}`,
    MAX_GOAL,
  );
}

async function handoff(
  input: Input,
  resolved: ResolvedSource,
  snapshot: Snapshot,
  symbols: string[],
  targetPaths: string[],
): Promise<JsonObject | null> {
  if (!targetPaths.length) return null;
  const investigationTerms = bugHandoffTerms(symbols, targetPaths);
  if (!investigationTerms.length) return null;
  const goal = buildBugGoal(resolved.label, resolved.text);
  const issueNumber = resolved.kind === 'issue' ? Number(resolved.id) : undefined;
  const fingerprint = await bugHandoffFingerprint({
    repository: input.repository,
    goal,
    evidenceSha: snapshot.sha,
    expectedBaseSha: snapshot.baseSha,
    targetPaths,
    investigationTerms,
    ...(issueNumber ? { issueNumber } : {}),
    ...(input.path ? { path: input.path } : {}),
    ...(input.language ? { language: input.language } : {}),
  });
  const operationId = `op-bug-${fingerprint}`;
  const branch = `gptomek/bug-${resolved.kind}-${fingerprint}`;
  return {
    operationId: 'implementCodeChange',
    path: CODE_CHANGE_PATH,
    input: {
      operationId,
      repository: input.repository,
      goal,
      branch,
      expectedBaseSha: snapshot.baseSha,
      targetPaths,
      investigationTerms,
      ...(issueNumber ? { issueNumber } : {}),
      ...(input.path ? { path: input.path } : {}),
      ...(input.language ? { language: input.language } : {}),
    },
  };
}

async function investigate(request: Request, invoke: Invoke): Promise<Response> {
  const input = await inputObject(request);
  const resolved = await resolveSource(request, invoke, input);
  const snapshot = await resolveSnapshot(
    request,
    invoke,
    input.repository,
    input.ref ?? resolved.suggestedRef ?? undefined,
  );
  const symbols = extractBugSymbols(resolved.text, input.hints, input.maxSymbols);

  const initialInvestigations = await Promise.all(
    symbols.map((symbol) => childAction(
      request,
      SYMBOL_INVESTIGATION_PATH,
      {
        repository: input.repository,
        symbol,
        maxFiles: input.maxFiles,
        ref: snapshot.sha,
        ...(input.path ? { path: input.path } : {}),
        ...(input.language ? { language: input.language } : {}),
      },
      (child) => handleSymbolInvestigationAction(child, invoke),
    )),
  );
  const investigations = await snapshotFallbackInvestigations(
    request,
    invoke,
    input,
    snapshot,
    symbols,
    initialInvestigations,
  );

  const stackCandidates = extractBugPaths(resolved.text);
  const candidatePaths = [...stackCandidates, ...(input.path ? [input.path] : [])];
  const verifiedPaths = await existingTargetPaths(request, invoke, input.repository, snapshot.sha, candidatePaths);
  const verifiedSet = new Set(verifiedPaths);
  const verifiedStackPaths = stackCandidates.filter((path) => verifiedSet.has(path));
  const hintedTarget = input.path && verifiedSet.has(input.path) ? input.path : null;
  const targets = collectTargetPaths(verifiedStackPaths, hintedTarget, investigations);
  const history = await Promise.all(
    targets.paths.slice(0, 3).map((path) => childAction(
      request,
      CODE_HISTORY_PATH,
      {
        repository: input.repository,
        path,
        ref: snapshot.sha,
        maxCommits: 5,
        ...(targets.symbolByPath.get(path) ? { symbol: targets.symbolByPath.get(path) } : {}),
      },
      (child) => handleCodeHistoryAction(child, invoke),
    )),
  );

  const verificationPlan = targets.paths.length
    ? await childAction(
        request,
        TARGETED_TESTS_PATH,
        { repository: input.repository, targetPaths: targets.paths, ref: snapshot.sha },
        (child) => handleTargetedTestsAction(child, invoke),
      )
    : { ok: false, error: 'no_target_paths' };

  const nextAction = await handoff(input, resolved, snapshot, symbols, targets.paths);
  return json({
    ok: true,
    source: {
      kind: resolved.kind,
      id: resolved.id,
      label: resolved.label,
      url: resolved.url,
      excerpt: compactText(resolved.text, 8_000),
      details: resolved.details,
    },
    snapshot: {
      defaultBranch: snapshot.defaultBranch,
      requestedRef: snapshot.requestedRef,
      sha: snapshot.sha,
      baseSha: snapshot.baseSha,
    },
    signals: {
      symbols,
      stackPaths: verifiedStackPaths,
      hintedTarget,
    },
    symbolInvestigations: investigations,
    targetPaths: targets.paths,
    history,
    verificationPlan,
    readyForFix: nextAction !== null,
    nextAction: nextAction ?? {
      type: 'investigate_more',
      note: targets.paths.length
        ? 'No downstream-safe investigation term was found. Add a symbol hint or narrow the target path.'
        : symbols.length
          ? 'No reliable target files were found. Add a path/language hint or inspect the returned symbol evidence.'
          : 'No reliable code symbols or target files were extracted. Retry with a symbol or exact file path hint.',
    },
  });
}

function objectResponse(description: string): JsonObject {
  return {
    description,
    content: { 'application/json': { schema: { type: 'object', properties: {} } } },
  };
}

export function addBugInvestigationOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[BUG_INVESTIGATION_PATH] = {
    post: {
      operationId: 'investigateBug',
      summary: 'Investigate an issue, failed workflow run or error report',
      description:
        'Pins the evidence to an exact repository snapshot, extracts likely symbols and stack paths, traces relevant code/history, discovers targeted verification, and returns a prefilled handoff to implementCodeChange. Exactly one of issueNumber, workflowRunId or errorText is required.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository'],
              oneOf: [
                { required: ['issueNumber'] },
                { required: ['workflowRunId'] },
                { required: ['errorText'] },
              ],
              properties: {
                repository: { type: 'string', example: 'trvny/trvny' },
                issueNumber: { type: 'integer', minimum: 1 },
                workflowRunId: { type: 'integer', minimum: 1 },
                errorText: { type: 'string', maxLength: MAX_SOURCE_TEXT },
                ref: { type: 'string', description: 'Optional branch, tag or exact SHA. Failed workflow runs default to their head SHA.' },
                hints: { type: 'array', maxItems: 8, items: { type: 'string', minLength: 2, maxLength: 80, pattern: '^[A-Za-z_][A-Za-z0-9_]*$' }, description: 'Optional exact code symbols to prioritize.' },
                path: { type: 'string', maxLength: 300, pattern: '^[A-Za-z0-9_./-]+$', description: 'Optional code-search path filter. If it names an exact file at the pinned snapshot, that file is seeded as a target.' },
                language: { type: 'string', maxLength: 40, pattern: '^[A-Za-z0-9#+._-]+$' },
                maxSymbols: { type: 'integer', minimum: 1, maximum: 6, default: 4 },
                maxFiles: { type: 'integer', minimum: 1, maximum: 10, default: 6 },
              },
            },
          },
        },
      },
      responses: {
        '200': objectResponse('Bug investigation bundle and code-change handoff'),
        '400': objectResponse('Invalid request'),
        '502': objectResponse('Dependent GitHub action failed'),
      },
    },
  };
}

export async function handleBugInvestigationAction(
  request: Request,
  invoke: Invoke,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== BUG_INVESTIGATION_PATH) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    return await investigate(request, invoke);
  } catch (error) {
    if (error instanceof BugInvestigationError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(JSON.stringify({
      bugInvestigation: 'failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    }));
    return json({ ok: false, error: 'bug_investigation_internal_error' }, 500);
  }
}
