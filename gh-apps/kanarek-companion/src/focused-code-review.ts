import {
  DEPENDENCY_GRAPH_PATH,
  handleDependencyGraphAction,
} from './dependency-graph.ts';

export const FOCUSED_CODE_REVIEW_PATH = '/gpt-actions/operator/code-review';

const READ_PATH = '/gpt-actions/github/read';
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_REVIEW_FILES = 12;
const MAX_GRAPH_FILES = 6;
const MAX_CALLERS = 6;
const MAX_PATCH_PER_FILE = 16_000;
const MAX_PATCH_TOTAL = 64_000;
const MAX_SIGNAL_LINES = 18;

const CONTRACT_RE = /\b(export|public|interface|type|enum|operationId|schema|required|properties|route|endpoint|request|response|api)\b/i;
const STATE_RE = /\b(null|undefined|state|status|revision|headSha|expected[A-Za-z_]*|lock|mutex|atomic|retry|cache|race)\b|Promise\.all|\bawait\b/i;
const EDGE_RE = /\b(if|else|switch|case|catch|throw|return|validate|invalid|limit|max|min|fallback)\b/i;

export type FocusedReviewInput = {
  repository: string;
  baseSha: string;
  headSha: string;
  targetPaths?: string[];
};

type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;
type ChangedFile = {
  path: string;
  previousPath: string | null;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string | null;
  patchTruncated: boolean;
  testFile: boolean;
  docsFile: boolean;
};
type DependencyEvidence = {
  path: string;
  basePath: string | null;
  headPath: string | null;
  before: JsonObject | null;
  after: JsonObject | null;
  callersBefore: string[];
  callersAfter: string[];
  addedCallers: string[];
  removedCallers: string[];
  unmodifiedCallers: string[];
  incomplete: boolean;
};

class FocusedReviewError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: JsonObject;

  constructor(code: string, status = 400, details: JsonObject = {}) {
    super(code);
    this.name = 'FocusedReviewError';
    this.code = code;
    this.status = status;
    this.details = details;
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
    throw new FocusedReviewError('repository_not_allowed', 403);
  }
  return value;
}

function sha(value: unknown, name: string): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new FocusedReviewError(`invalid_${name}`);
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

function optionalPaths(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_REVIEW_FILES) {
    throw new FocusedReviewError('invalid_target_paths');
  }
  const paths = value.map((entry) => {
    if (!validPath(entry)) throw new FocusedReviewError('invalid_target_paths');
    return entry;
  });
  if (new Set(paths).size !== paths.length) throw new FocusedReviewError('invalid_target_paths');
  return paths;
}

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > 64_000) throw new FocusedReviewError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new FocusedReviewError('invalid_json');
  }
  if (!isObject(value)) throw new FocusedReviewError('invalid_json_object');
  return value;
}

function parseInput(value: JsonObject): FocusedReviewInput {
  const allowed = new Set(['repository', 'baseSha', 'headSha', 'targetPaths']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new FocusedReviewError('invalid_code_review_request');
  }
  const baseSha = sha(value.baseSha, 'base_sha');
  const headSha = sha(value.headSha, 'head_sha');
  if (baseSha === headSha) throw new FocusedReviewError('identical_review_snapshots');
  return {
    repository: repository(value.repository),
    baseSha,
    headSha,
    targetPaths: optionalPaths(value.targetPaths),
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
    throw new FocusedReviewError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new FocusedReviewError('invalid_action_response', 502);
  return value;
}

async function readData(source: Request, invoke: Invoke, path: string): Promise<unknown> {
  const response = await invoke(internalRequest(source, READ_PATH, { path }));
  const payload = await responseObject(response);
  if (!response.ok || payload.ok !== true) {
    throw new FocusedReviewError(
      typeof payload.error === 'string' ? payload.error : `read_${response.status}`,
      response.status,
      payload,
    );
  }
  return payload.data;
}

function repoPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function likelyTestPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    /(^|\/)(test|tests|__tests__|spec)(\/|$)/.test(normalized) ||
    /(?:^|[._-])(test|tests|spec)\.[a-z0-9]+$/.test(normalized)
  );
}

function likelyDocsPath(path: string): boolean {
  const normalized = path.toLowerCase();
  return (
    normalized.endsWith('.md') ||
    normalized.endsWith('.mdx') ||
    normalized.endsWith('.rst') ||
    normalized.startsWith('docs/') ||
    normalized.includes('/docs/')
  );
}

function addedRemovedLines(patch: string | null): string[] {
  if (!patch) return [];
  return patch
    .split(/\r?\n/)
    .filter((line) => (line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---')))
    .map((line) => line.slice(1).trim())
    .filter(Boolean);
}

function signalLines(files: ChangedFile[], pattern: RegExp): Array<{ path: string; line: string }> {
  const result: Array<{ path: string; line: string }> = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const line of addedRemovedLines(file.patch)) {
      if (!pattern.test(line)) continue;
      const key = `${file.path}\n${line}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ path: file.path, line: line.slice(0, 500) });
      if (result.length >= MAX_SIGNAL_LINES) return result;
    }
  }
  return result;
}

function compactPatch(value: unknown, remaining: number): { patch: string | null; truncated: boolean; used: number } {
  if (typeof value !== 'string' || !value) return { patch: null, truncated: false, used: 0 };
  const limit = Math.max(0, Math.min(MAX_PATCH_PER_FILE, remaining));
  if (!limit) return { patch: null, truncated: true, used: 0 };
  const truncated = value.length > limit;
  const patch = truncated ? `${value.slice(0, limit)}\n... [patch truncated]` : value;
  return { patch, truncated, used: Math.min(value.length, limit) };
}

function changedFiles(rawFiles: unknown[]): ChangedFile[] {
  if (rawFiles.length > MAX_REVIEW_FILES) {
    throw new FocusedReviewError('review_scope_too_large', 409, {
      changedFiles: rawFiles.length,
      maxFiles: MAX_REVIEW_FILES,
    });
  }
  let remainingPatch = MAX_PATCH_TOTAL;
  return rawFiles.map((value) => {
    if (!isObject(value)) throw new FocusedReviewError('invalid_compare_response', 502);
    const path = stringValue(value.filename);
    const status = stringValue(value.status);
    if (!path || !validPath(path) || !status) {
      throw new FocusedReviewError('invalid_compare_response', 502);
    }
    const compact = compactPatch(value.patch, remainingPatch);
    remainingPatch -= compact.used;
    return {
      path,
      previousPath: validPath(value.previous_filename) ? value.previous_filename : null,
      status,
      additions: numberValue(value.additions) ?? 0,
      deletions: numberValue(value.deletions) ?? 0,
      changes: numberValue(value.changes) ?? 0,
      patch: compact.patch,
      patchTruncated: compact.truncated,
      testFile: likelyTestPath(path),
      docsFile: likelyDocsPath(path),
    };
  });
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function graphCallers(payload: JsonObject | null): string[] {
  return payload ? arrayStrings(payload.affectedModules) : [];
}

function graphIncomplete(payload: JsonObject | null): boolean {
  if (!payload) return true;
  const search = isObject(payload.callerSearch) ? payload.callerSearch : null;
  const repository = isObject(payload.repository) ? payload.repository : null;
  const requestedRef = repository ? stringValue(repository.requestedRef) : null;
  const searchIndexedBranch = repository ? stringValue(repository.searchIndexedBranch) : null;
  return Boolean(
    search?.incompleteResults === true ||
    search?.callersTruncated === true ||
    !requestedRef ||
    !searchIndexedBranch ||
    requestedRef !== searchIndexedBranch
  );
}

async function dependencyGraph(
  source: Request,
  invoke: Invoke,
  input: FocusedReviewInput,
  path: string,
  ref: string,
): Promise<JsonObject | null> {
  const response = await handleDependencyGraphAction(
    internalRequest(source, DEPENDENCY_GRAPH_PATH, {
      repository: input.repository,
      path,
      ref,
      maxCallers: MAX_CALLERS,
    }),
    invoke,
  );
  if (!response) throw new FocusedReviewError('dependency_route_missing', 502);
  const payload = await responseObject(response);
  return response.ok && payload.ok === true ? payload : null;
}

async function dependencyEvidence(
  source: Request,
  invoke: Invoke,
  input: FocusedReviewInput,
  files: ChangedFile[],
): Promise<DependencyEvidence[]> {
  const changed = new Set(files.map((file) => file.path));
  for (const file of files) {
    if (file.previousPath) changed.add(file.previousPath);
  }
  const targets = files
    .filter((file) => !file.testFile && !file.docsFile)
    .slice(0, MAX_GRAPH_FILES);

  return Promise.all(targets.map(async (file) => {
    const basePath = file.status === 'added' ? null : (file.previousPath ?? file.path);
    const headPath = file.status === 'removed' ? null : file.path;
    const [before, after] = await Promise.all([
      basePath ? dependencyGraph(source, invoke, input, basePath, input.baseSha) : Promise.resolve(null),
      headPath ? dependencyGraph(source, invoke, input, headPath, input.headSha) : Promise.resolve(null),
    ]);
    const callersBefore = graphCallers(before);
    const callersAfter = graphCallers(after);
    const beforeSet = new Set(callersBefore);
    const afterSet = new Set(callersAfter);
    const union = new Set([...callersBefore, ...callersAfter]);
    return {
      path: file.path,
      basePath,
      headPath,
      before,
      after,
      callersBefore,
      callersAfter,
      addedCallers: callersAfter.filter((path) => !beforeSet.has(path)),
      removedCallers: callersBefore.filter((path) => !afterSet.has(path)),
      unmodifiedCallers: [...union].filter((path) => !changed.has(path)),
      incomplete:
        (basePath ? graphIncomplete(before) : false) ||
        (headPath ? graphIncomplete(after) : false),
    };
  }));
}

export function focusedReviewScopeBlockers(review: JsonObject): string[] {
  const scope = isObject(review.scope) ? review.scope : null;
  if (!scope || !Array.isArray(scope.unexpectedChangedPaths)) return ['invalid_focused_review_scope'];
  return scope.unexpectedChangedPaths
    .filter((path): path is string => typeof path === 'string')
    .map((path) => `unexpected_changed_path:${path}`);
}

export function reviewLensSummary(
  files: ChangedFile[],
  dependencies: DependencyEvidence[],
  declaredPaths: string[] | undefined,
): JsonObject {
  const changed = files.map((file) => file.path);
  const declared = declaredPaths ?? [];
  const declaredSet = new Set(declared);
  const changedSet = new Set(changed);
  const production = files.filter((file) => !file.testFile && !file.docsFile).map((file) => file.path);
  const tests = files.filter((file) => file.testFile).map((file) => file.path);
  const docs = files.filter((file) => file.docsFile).map((file) => file.path);
  const callerCandidates = [...new Set(dependencies.flatMap((entry) => entry.unmodifiedCallers))];
  return {
    scope: {
      declaredPaths: declared,
      changedPaths: changed,
      unexpectedChangedPaths: declaredPaths ? changed.filter((path) => !declaredSet.has(path)) : [],
      declaredButUnchanged: declaredPaths ? declared.filter((path) => !changedSet.has(path)) : [],
    },
    tests: {
      changedTests: tests,
      productionPaths: production,
      productionWithoutChangedTests: production.length > 0 && tests.length === 0 ? production : [],
    },
    docs: { changedDocs: docs },
    missedCallers: {
      candidates: callerCandidates,
      incompleteTargets: dependencies.filter((entry) => entry.incomplete).map((entry) => entry.path),
    },
    apiContract: { signals: signalLines(files, CONTRACT_RE) },
    stateAndRace: { signals: signalLines(files, STATE_RE) },
    edgeCases: { signals: signalLines(files, EDGE_RE) },
  };
}

export async function buildFocusedCodeReview(
  source: Request,
  invoke: Invoke,
  input: FocusedReviewInput,
): Promise<JsonObject> {
  const repo = repoPath(input.repository);
  const [baseCommit, headCommit, compare] = await Promise.all([
    readData(source, invoke, `/repos/${repo}/commits/${input.baseSha}`),
    readData(source, invoke, `/repos/${repo}/commits/${input.headSha}`),
    readData(source, invoke, `/repos/${repo}/compare/${input.baseSha}...${input.headSha}`),
  ]);
  const resolvedBase = isObject(baseCommit) ? stringValue(baseCommit.sha) : null;
  const resolvedHead = isObject(headCommit) ? stringValue(headCommit.sha) : null;
  if (resolvedBase?.toLowerCase() !== input.baseSha || resolvedHead?.toLowerCase() !== input.headSha) {
    throw new FocusedReviewError('review_snapshot_changed', 409);
  }
  if (!isObject(compare) || !Array.isArray(compare.files)) {
    throw new FocusedReviewError('invalid_compare_response', 502);
  }
  if (compare.status !== 'ahead') {
    throw new FocusedReviewError('review_head_not_ahead', 409, { compareStatus: compare.status ?? null });
  }

  const files = changedFiles(compare.files);
  if (!files.length) throw new FocusedReviewError('empty_code_review', 409);
  const dependencies = await dependencyEvidence(source, invoke, input, files);
  const lenses = reviewLensSummary(files, dependencies, input.targetPaths);
  const scope = isObject(lenses.scope) ? lenses.scope : {};
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return {
    ok: true,
    repository: input.repository,
    snapshots: { baseSha: input.baseSha, headSha: input.headSha },
    summary: {
      changedFiles: files.length,
      additions,
      deletions,
      productionFiles: files.filter((file) => !file.testFile && !file.docsFile).length,
      testFiles: files.filter((file) => file.testFile).length,
      docsFiles: files.filter((file) => file.docsFile).length,
      patchesTruncated: files.some((file) => file.patchTruncated),
    },
    scope,
    files,
    dependencies,
    reviewLenses: {
      tests: lenses.tests,
      docs: lenses.docs,
      missedCallers: lenses.missedCallers,
      apiContract: lenses.apiContract,
      stateAndRace: lenses.stateAndRace,
      edgeCases: lenses.edgeCases,
    },
    checklist: [
      'Check unmodified callers for assumptions invalidated by the diff.',
      'Check public/API/schema changes for compatibility and missing migrations.',
      'Check null, state, retry and async paths for stale-state or race behavior.',
      'Check error, limit, fallback and boundary branches for missing edge cases.',
      'Check whether production behavior changed without focused tests.',
      'Check that every changed path belongs to the intended change scope.',
    ],
    nextAction: {
      type: 'semantic_review',
      reviewedHeadSha: input.headSha,
      note: 'Use the exact diff and evidence above. Report only actionable findings; do not treat heuristic signals as defects by themselves.',
    },
  };
}

function objectResponse(description: string): JsonObject {
  return {
    description,
    content: { 'application/json': { schema: { type: 'object', properties: {} } } },
  };
}

export function addFocusedCodeReviewOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[FOCUSED_CODE_REVIEW_PATH] = {
    post: {
      operationId: 'reviewCodeChange',
      summary: 'Build an exact-snapshot focused code-review pass',
      description:
        'Compares exact base/head SHAs, bounds the diff, checks intended scope, traces likely callers before/after, surfaces test coverage gaps and highlights contract/state/edge-case evidence for semantic review.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository', 'baseSha', 'headSha'],
              properties: {
                repository: { type: 'string', example: 'trvny/trvny' },
                baseSha: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' },
                headSha: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' },
                targetPaths: {
                  type: 'array',
                  minItems: 1,
                  maxItems: MAX_REVIEW_FILES,
                  items: { type: 'string' },
                  description: 'Optional intended edit scope used to detect accidental scope growth.',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': objectResponse('Focused code-review evidence'),
        '400': objectResponse('Invalid review request'),
        '409': objectResponse('Review scope or snapshot conflict'),
        '502': objectResponse('Dependent GitHub read failed'),
      },
    },
  };
}

export async function handleFocusedCodeReviewAction(
  request: Request,
  invoke: Invoke,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== FOCUSED_CODE_REVIEW_PATH) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    const raw = await inputObject(request);
    return json(await buildFocusedCodeReview(request, invoke, parseInput(raw)));
  } catch (error) {
    if (error instanceof FocusedReviewError) {
      return json({ ok: false, error: error.code, ...error.details }, error.status);
    }
    console.error(JSON.stringify({
      focusedCodeReview: 'failed',
      error: error instanceof Error ? error.message : 'unknown_error',
    }));
    return json({ ok: false, error: 'focused_code_review_internal_error' }, 500);
  }
}
