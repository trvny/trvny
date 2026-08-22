export const CODE_HISTORY_PATH = '/gpt-actions/github/code/history';

const READ_PATH = '/gpt-actions/github/read';
const GRAPHQL_PATH = '/gpt-actions/github/graphql';
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_CONTENT_BYTES = 600_000;
const MAX_BLAME_RANGES = 80;
const MAX_PR_LOOKUPS = 12;
const MAX_SYMBOL_LINES = 50;

type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;

type Input = {
  repository: string;
  path: string;
  ref?: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  maxCommits: number;
};

type PullLookup = {
  pulls: JsonObject[];
  ok: boolean;
};

export type BlameRangeLike = {
  startingLine: number;
  endingLine: number;
  commit?: unknown;
  age?: unknown;
};

export type SymbolMatchSummary = {
  lines: number[];
  total: number;
  truncated: boolean;
};

class CodeHistoryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'CodeHistoryError';
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
    throw new CodeHistoryError('repository_not_allowed', 403);
  }
  return value;
}

function pathValue(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 600 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('..') ||
    value.includes('//') ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new CodeHistoryError('invalid_path');
  }
  return value;
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
  if (!refAllowed(value)) throw new CodeHistoryError('invalid_ref');
  return value;
}

function symbolAllowed(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.length <= 128 &&
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
  );
}

function optionalSymbol(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!symbolAllowed(value)) throw new CodeHistoryError('invalid_symbol');
  return value;
}

function positiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new CodeHistoryError(`invalid_${name}`);
  }
  return value;
}

function maxCommits(value: unknown): number {
  if (value === undefined) return 6;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 10) {
    throw new CodeHistoryError('invalid_max_commits');
  }
  return value;
}

async function inputObject(request: Request): Promise<Input> {
  const text = await request.clone().text();
  if (text.length > 16_000) throw new CodeHistoryError('payload_too_large', 413);
  let value: unknown = {};
  try {
    if (text.trim()) value = JSON.parse(text);
  } catch {
    throw new CodeHistoryError('invalid_json');
  }
  if (!isObject(value)) throw new CodeHistoryError('invalid_json_object');
  const allowed = new Set([
    'repository',
    'path',
    'ref',
    'symbol',
    'startLine',
    'endLine',
    'maxCommits',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new CodeHistoryError('invalid_code_history_request');
  }

  const startLine = positiveInteger(value.startLine, 'start_line');
  const endLine = positiveInteger(value.endLine, 'end_line');
  if ((startLine === undefined) !== (endLine === undefined)) {
    throw new CodeHistoryError('line_range_requires_start_and_end');
  }
  if (startLine !== undefined && endLine !== undefined) {
    if (endLine < startLine || endLine - startLine > 300) {
      throw new CodeHistoryError('invalid_line_range');
    }
  }

  return {
    repository: repository(value.repository),
    path: pathValue(value.path),
    ref: optionalRef(value.ref),
    symbol: optionalSymbol(value.symbol),
    startLine,
    endLine,
    maxCommits: maxCommits(value.maxCommits),
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
    throw new CodeHistoryError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new CodeHistoryError('invalid_action_response', 502);
  if (!response.ok || value.ok !== true) {
    throw new CodeHistoryError(
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

async function graphqlData(
  source: Request,
  invoke: Invoke,
  query: string,
  variables: JsonObject,
): Promise<unknown> {
  const payload = await responseObject(
    await invoke(internalRequest(source, GRAPHQL_PATH, { query, variables })),
  );
  const raw = payload.data;
  if (isObject(raw) && Array.isArray(raw.errors) && raw.errors.length) {
    throw new CodeHistoryError('github_graphql_error', 502);
  }
  return isObject(raw) ? raw.data : null;
}

function repoPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function filePath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decodeContent(value: unknown): string | null {
  if (!isObject(value) || value.encoding !== 'base64' || typeof value.content !== 'string') return null;
  const size = numberValue(value.size);
  if (size !== null && size > MAX_CONTENT_BYTES) return null;
  try {
    const binary = atob(value.content.replace(/\s/g, ''));
    if (binary.length > MAX_CONTENT_BYTES) return null;
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function symbolLineMatches(
  content: string,
  symbol: string,
  limit = MAX_SYMBOL_LINES,
): SymbolMatchSummary {
  const escaped = escapeRegExp(symbol);
  const pattern = new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`);
  const contentLines = content.split(/\r?\n/);
  const lines: number[] = [];
  let total = 0;
  for (let index = 0; index < contentLines.length; index += 1) {
    if (!pattern.test(contentLines[index])) continue;
    total += 1;
    if (lines.length < limit) lines.push(index + 1);
  }
  return { lines, total, truncated: total > lines.length };
}

export function symbolLineNumbers(content: string, symbol: string, limit = MAX_SYMBOL_LINES): number[] {
  return symbolLineMatches(content, symbol, limit).lines;
}

function symbolContexts(content: string, lines: number[]): JsonObject[] {
  const split = content.split(/\r?\n/);
  return lines.slice(0, 20).map((line) => ({
    line,
    text: (split[line - 1] ?? '').trim().slice(0, 280),
  }));
}

export function selectBlameRanges<T extends BlameRangeLike>(
  ranges: T[],
  startLine?: number,
  endLine?: number,
  symbolLines: number[] = [],
  limit = MAX_BLAME_RANGES,
  symbolRequested = false,
): T[] {
  const focused =
    (startLine !== undefined && endLine !== undefined) || symbolRequested || symbolLines.length > 0;
  const selected = focused
    ? ranges.filter((range) => {
        const overlapsRange =
          startLine !== undefined &&
          endLine !== undefined &&
          range.startingLine <= endLine &&
          range.endingLine >= startLine;
        const overlapsSymbol = symbolLines.some(
          (line) => line >= range.startingLine && line <= range.endingLine,
        );
        return overlapsRange || overlapsSymbol;
      })
    : ranges;
  return selected.slice(0, limit);
}

async function resolveSnapshot(
  request: Request,
  invoke: Invoke,
  repositoryName: string,
  requestedRef?: string,
): Promise<{ requestedRef: string; sha: string }> {
  const repo = repoPath(repositoryName);
  let ref = requestedRef;
  if (!ref) {
    const metadata = await readData(request, invoke, `/repos/${repo}`);
    if (!isObject(metadata) || typeof metadata.default_branch !== 'string') {
      throw new CodeHistoryError('invalid_repository_response', 502);
    }
    ref = metadata.default_branch;
  }
  const commit = await readData(request, invoke, `/repos/${repo}/commits/${encodeURIComponent(ref)}`);
  if (!isObject(commit) || typeof commit.sha !== 'string' || !SHA_RE.test(commit.sha)) {
    throw new CodeHistoryError('invalid_commit_response', 502);
  }
  return { requestedRef: ref, sha: commit.sha.toLowerCase() };
}

async function fileContentAtSnapshot(
  request: Request,
  invoke: Invoke,
  repositoryName: string,
  path: string,
  sha: string,
): Promise<string | null> {
  const repo = repoPath(repositoryName);
  const raw = await readData(
    request,
    invoke,
    `/repos/${repo}/contents/${filePath(path)}?ref=${encodeURIComponent(sha)}`,
  );
  return decodeContent(raw);
}

const BLAME_QUERY = `
query CodeBlame($owner: String!, $name: String!, $expression: String!, $path: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: $expression) {
      ... on Commit {
        oid
        blame(path: $path) {
          ranges {
            startingLine
            endingLine
            age
            commit {
              oid
              abbreviatedOid
              messageHeadline
              committedDate
              url
              author {
                name
                email
                user { login }
              }
            }
          }
        }
      }
    }
  }
}`;

function rawBlameRanges(value: unknown): JsonObject[] {
  if (!isObject(value) || !isObject(value.repository) || !isObject(value.repository.object)) {
    throw new CodeHistoryError('invalid_blame_response', 502);
  }
  const object = value.repository.object;
  if (!isObject(object.blame) || !Array.isArray(object.blame.ranges)) {
    throw new CodeHistoryError('invalid_blame_response', 502);
  }
  return object.blame.ranges.filter(isObject);
}

function compactPull(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const base = isObject(value.base) ? value.base : {};
  const head = isObject(value.head) ? value.head : {};
  return {
    number: numberValue(value.number),
    title: stringValue(value.title),
    state: stringValue(value.state),
    merged: value.merged_at !== null && value.merged_at !== undefined,
    mergedAt: stringValue(value.merged_at),
    htmlUrl: stringValue(value.html_url),
    base: stringValue(base.ref),
    head: stringValue(head.ref),
  };
}

async function pullsForCommit(
  request: Request,
  invoke: Invoke,
  repositoryName: string,
  sha: string,
): Promise<PullLookup> {
  const repo = repoPath(repositoryName);
  try {
    const raw = await readData(
      request,
      invoke,
      `/repos/${repo}/commits/${sha}/pulls?per_page=5`,
    );
    if (!Array.isArray(raw)) return { pulls: [], ok: false };
    return {
      pulls: raw.map(compactPull).filter((pull): pull is JsonObject => Boolean(pull)),
      ok: true,
    };
  } catch {
    return { pulls: [], ok: false };
  }
}

function compactCommit(
  value: unknown,
  pulls: JsonObject[] = [],
  pullRequestsQueried = false,
): JsonObject | null {
  if (!isObject(value) || typeof value.sha !== 'string') return null;
  const commit = isObject(value.commit) ? value.commit : {};
  const author = isObject(commit.author) ? commit.author : {};
  const githubAuthor = isObject(value.author) ? value.author : {};
  const message = stringValue(commit.message);
  return {
    sha: value.sha,
    abbreviatedSha: value.sha.slice(0, 12),
    message: message ? message.split('\n')[0].slice(0, 300) : null,
    committedAt: stringValue(author.date),
    author: {
      login: stringValue(githubAuthor.login),
      name: stringValue(author.name),
      email: stringValue(author.email),
    },
    htmlUrl: stringValue(value.html_url),
    pullRequests: pulls,
    pullRequestsQueried,
  };
}

function blameCommit(
  value: unknown,
  pulls: JsonObject[],
  pullRequestsQueried: boolean,
): JsonObject | null {
  if (!isObject(value) || typeof value.oid !== 'string') return null;
  const author = isObject(value.author) ? value.author : {};
  const user = isObject(author.user) ? author.user : {};
  return {
    sha: value.oid,
    abbreviatedSha: stringValue(value.abbreviatedOid) ?? value.oid.slice(0, 12),
    message: stringValue(value.messageHeadline),
    committedAt: stringValue(value.committedDate),
    author: {
      login: stringValue(user.login),
      name: stringValue(author.name),
      email: stringValue(author.email),
    },
    url: stringValue(value.url),
    pullRequests: pulls,
    pullRequestsQueried,
  };
}

async function codeHistory(request: Request, invoke: Invoke): Promise<Response> {
  const input = await inputObject(request);
  const snapshot = await resolveSnapshot(request, invoke, input.repository, input.ref);
  const [owner, name] = input.repository.split('/');
  const content = input.symbol
    ? await fileContentAtSnapshot(request, invoke, input.repository, input.path, snapshot.sha)
    : null;
  const symbolMatch = input.symbol && content
    ? symbolLineMatches(content, input.symbol)
    : { lines: [], total: 0, truncated: false };
  const symbolLines = symbolMatch.lines;
  const symbolRequested = input.symbol !== undefined;
  const focused =
    (input.startLine !== undefined && input.endLine !== undefined) || symbolRequested;

  const [blameGraphql, recentRaw] = await Promise.all([
    graphqlData(request, invoke, BLAME_QUERY, {
      owner,
      name,
      expression: snapshot.sha,
      path: input.path,
    }),
    readData(
      request,
      invoke,
      `/repos/${repoPath(input.repository)}/commits?sha=${encodeURIComponent(snapshot.sha)}&path=${encodeURIComponent(input.path)}&per_page=${input.maxCommits}`,
    ),
  ]);

  const allRanges = rawBlameRanges(blameGraphql);
  const selectedRanges = selectBlameRanges(
    allRanges
      .map((range): BlameRangeLike => ({
        ...range,
        startingLine: numberValue(range.startingLine) ?? 0,
        endingLine: numberValue(range.endingLine) ?? 0,
      }))
      .filter((range) => range.startingLine > 0 && range.endingLine >= range.startingLine),
    input.startLine,
    input.endLine,
    symbolLines,
    MAX_BLAME_RANGES,
    symbolRequested,
  );

  const recent = Array.isArray(recentRaw) ? recentRaw.filter(isObject).slice(0, input.maxCommits) : [];
  const recentShas: string[] = [];
  for (const commit of recent) {
    if (typeof commit.sha !== 'string' || !SHA_RE.test(commit.sha)) continue;
    const sha = commit.sha.toLowerCase();
    if (!recentShas.includes(sha)) recentShas.push(sha);
  }
  const blameShas: string[] = [];
  for (const range of selectedRanges) {
    if (!isObject(range.commit) || typeof range.commit.oid !== 'string' || !SHA_RE.test(range.commit.oid)) {
      continue;
    }
    const sha = range.commit.oid.toLowerCase();
    if (!recentShas.includes(sha) && !blameShas.includes(sha)) blameShas.push(sha);
  }
  const lookupShas = [...recentShas, ...blameShas].slice(0, MAX_PR_LOOKUPS);
  const pullEntries = await Promise.all(
    lookupShas.map(async (sha) => [sha, await pullsForCommit(request, invoke, input.repository, sha)] as const),
  );
  const pullMap = new Map<string, JsonObject[]>(
    pullEntries.map(([sha, result]) => [sha, result.pulls]),
  );
  const queriedShas = new Set(
    pullEntries.filter(([, result]) => result.ok).map(([sha]) => sha),
  );
  const failedShas = new Set(
    pullEntries.filter(([, result]) => !result.ok).map(([sha]) => sha),
  );

  const blame = selectedRanges.map((range) => {
    const rawCommit = isObject(range.commit) ? range.commit : null;
    const sha = rawCommit && typeof rawCommit.oid === 'string' ? rawCommit.oid.toLowerCase() : '';
    return {
      startingLine: range.startingLine,
      endingLine: range.endingLine,
      age: numberValue(range.age),
      commit: rawCommit
        ? blameCommit(rawCommit, pullMap.get(sha) ?? [], queriedShas.has(sha))
        : null,
    };
  });

  const recentCommits = recent
    .map((commit) => {
      const sha = typeof commit.sha === 'string' ? commit.sha.toLowerCase() : '';
      return compactCommit(commit, pullMap.get(sha) ?? [], queriedShas.has(sha));
    })
    .filter((commit): commit is JsonObject => Boolean(commit));

  const matchingRanges = focused
    ? allRanges.filter((range) => {
        const start = numberValue(range.startingLine) ?? 0;
        const end = numberValue(range.endingLine) ?? 0;
        const lineRange =
          input.startLine !== undefined && input.endLine !== undefined
            ? start <= input.endLine && end >= input.startLine
            : false;
        const symbolRange = symbolLines.some((line) => line >= start && line <= end);
        return lineRange || symbolRange;
      }).length
    : allRanges.length;

  return json({
    ok: true,
    repository: input.repository,
    path: input.path,
    snapshot: {
      requestedRef: snapshot.requestedRef,
      sha: snapshot.sha,
    },
    focus: {
      symbol: input.symbol ?? null,
      symbolMatches: input.symbol
        ? {
            count: symbolMatch.total,
            returnedCount: symbolLines.length,
            truncated: symbolMatch.truncated,
            lines: symbolLines,
            contexts: content ? symbolContexts(content, symbolLines) : [],
            contentUnavailable: content === null,
          }
        : null,
      lineRange:
        input.startLine !== undefined && input.endLine !== undefined
          ? { start: input.startLine, end: input.endLine }
          : null,
    },
    blame: {
      totalRanges: allRanges.length,
      returnedRanges: blame.length,
      focused,
      truncated: symbolMatch.truncated || blame.length < matchingRanges,
      ranges: blame,
    },
    enrichment: {
      pullRequestLookupBudget: MAX_PR_LOOKUPS,
      attemptedCommitShas: lookupShas,
      queriedCommitShas: [...queriedShas],
      failedCommitShas: [...failedShas],
    },
    recentCommits,
  });
}

function objectResponse(description: string): JsonObject {
  return {
    description,
    content: { 'application/json': { schema: { type: 'object', properties: {} } } },
  };
}

export function addCodeHistoryOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[CODE_HISTORY_PATH] = {
    post: {
      operationId: 'investigateCodeHistory',
      summary: 'Trace focused code blame and history',
      description:
        'Resolves an exact ref snapshot, returns GitHub blame ranges for a file/symbol/line range, recent file commits and associated pull requests.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository', 'path'],
              properties: {
                repository: { type: 'string', example: 'trvny/trvny' },
                path: { type: 'string', example: 'gh-apps/kanarek-companion/src/runtime-entry.ts' },
                ref: { type: 'string', description: 'Optional branch, tag or exact commit SHA.' },
                symbol: { type: 'string', description: 'Optional identifier used to focus blame ranges.' },
                startLine: { type: 'integer', minimum: 1 },
                endLine: { type: 'integer', minimum: 1 },
                maxCommits: { type: 'integer', minimum: 1, maximum: 10, default: 6 },
              },
            },
          },
        },
      },
      responses: {
        '200': objectResponse('Focused code blame and history'),
        '400': objectResponse('Invalid history request'),
        '502': objectResponse('GitHub history lookup failed'),
      },
    },
  };
}

export async function handleCodeHistoryAction(
  request: Request,
  invoke: Invoke,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== CODE_HISTORY_PATH) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    return await codeHistory(request, invoke);
  } catch (error) {
    if (error instanceof CodeHistoryError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        codeHistory: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'code_history_internal_error' }, 500);
  }
}
