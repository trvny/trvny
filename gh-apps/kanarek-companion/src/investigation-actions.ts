import { handleGptActions, type GptActionsEnv } from './gpt-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const CODE_INVESTIGATION_PATH = '/gpt-actions/github/code/investigate';
const SHA_RE = /^[0-9a-f]{40}$/i;

type JsonObject = Record<string, unknown>;

class InvestigationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'InvestigationError';
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
    throw new InvestigationError('repository_not_allowed', 403);
  }
  return value;
}

function terms(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    throw new InvestigationError('invalid_terms');
  }
  const result = value.map((term) => {
    if (
      typeof term !== 'string' ||
      term.length < 2 ||
      term.length > 80 ||
      !/^[A-Za-z0-9_./@+-]+$/.test(term)
    ) {
      throw new InvestigationError('invalid_terms');
    }
    return term;
  });
  if (new Set(result.map((term) => term.toLowerCase())).size !== result.length) {
    throw new InvestigationError('duplicate_terms');
  }
  return result;
}

function maxFiles(value: unknown): number {
  if (value === undefined) return 5;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 6) {
    throw new InvestigationError('invalid_max_files');
  }
  return value;
}

function optionalBoolean(value: unknown, name: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new InvestigationError(`invalid_${name}`);
  return value;
}

function pathFilter(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 300 ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.includes('..') ||
    value.includes('//') ||
    !/^[A-Za-z0-9_./-]+$/.test(value)
  ) {
    throw new InvestigationError('invalid_path');
  }
  return value;
}

function languageFilter(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 40 || !/^[A-Za-z0-9#+._-]+$/.test(value)) {
    throw new InvestigationError('invalid_language');
  }
  return value;
}

export function investigationRefAllowed(value: unknown): value is string {
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

function requestedRef(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!investigationRefAllowed(value)) throw new InvestigationError('invalid_ref');
  return value;
}

export function buildCodeSearchQuery(
  repositoryName: string,
  searchTerms: string[],
  path?: string,
  language?: string,
): string {
  return [
    ...searchTerms,
    `repo:${repositoryName}`,
    ...(path ? [`path:${path}`] : []),
    ...(language ? [`language:${language}`] : []),
  ].join(' ');
}

function repoPath(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function filePath(value: string): string {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/');
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
  if (text.length > 64_000) throw new InvestigationError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new InvestigationError('invalid_json');
  }
  if (!isObject(value)) throw new InvestigationError('invalid_json_object');
  return value;
}

async function actionPayload(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new InvestigationError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new InvestigationError('invalid_action_response', 502);
  if (!response.ok) {
    throw new InvestigationError(
      typeof value.error === 'string' ? value.error : 'action_failed',
      response.status,
    );
  }
  return value;
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
  return (await actionPayload(await readResponse(source, env, fetcher, path))).data;
}

function decodeContent(value: unknown): string | null {
  if (!isObject(value) || value.encoding !== 'base64' || typeof value.content !== 'string') return null;
  try {
    const binary = atob(value.content.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

export interface CodeSnippet {
  startLine: number;
  endLine: number;
  text: string;
}

export function buildCodeSnippets(
  content: string,
  searchTerms: string[],
  maxSnippets = 6,
): CodeSnippet[] {
  const lines = content.split(/\r?\n/);
  const lowered = searchTerms.map((term) => term.toLowerCase());
  const hits: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].toLowerCase();
    if (lowered.some((term) => line.includes(term))) hits.push(index);
  }

  const windows: Array<[number, number]> = [];
  for (const hit of hits) {
    const start = Math.max(0, hit - 2);
    const end = Math.min(lines.length - 1, hit + 2);
    const previous = windows.at(-1);
    if (previous && start <= previous[1] + 1) {
      previous[1] = Math.max(previous[1], end);
    } else if (windows.length < maxSnippets) {
      windows.push([start, end]);
    }
  }

  return windows.map(([start, end]) => ({
    startLine: start + 1,
    endLine: end + 1,
    text: lines
      .slice(start, end + 1)
      .map((line, offset) => `${start + offset + 1}: ${line}`)
      .join('\n')
      .slice(0, 8_000),
  }));
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactHistory(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const commit = isObject(value.commit) ? value.commit : {};
  const author = isObject(commit.author) ? commit.author : {};
  const message = stringValue(commit.message);
  return {
    sha: stringValue(value.sha),
    message: message ? message.split(/\r?\n/, 1)[0].slice(0, 500) : null,
    date: stringValue(author.date),
    htmlUrl: stringValue(value.html_url),
  };
}

async function resolveSnapshot(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
  repositoryName: string,
  ref: string | undefined,
): Promise<{ defaultBranch: string; requestedRef: string; resolvedSha: string }> {
  const repo = repoPath(repositoryName);
  const repositoryRaw = await readData(request, env, fetcher, `/repos/${repo}`);
  if (!isObject(repositoryRaw) || typeof repositoryRaw.default_branch !== 'string') {
    throw new InvestigationError('invalid_repository_response', 502);
  }
  const target = ref ?? repositoryRaw.default_branch;
  const commitRaw = await readData(
    request,
    env,
    fetcher,
    `/repos/${repo}/commits/${encodeURIComponent(target)}`,
  );
  if (!isObject(commitRaw) || typeof commitRaw.sha !== 'string' || !SHA_RE.test(commitRaw.sha)) {
    throw new InvestigationError('invalid_ref_response', 502);
  }
  return {
    defaultBranch: repositoryRaw.default_branch,
    requestedRef: target,
    resolvedSha: commitRaw.sha.toLowerCase(),
  };
}

async function investigateCode(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const repositoryName = repository(input.repository);
  const searchTerms = terms(input.terms);
  const limit = maxFiles(input.maxFiles);
  const path = pathFilter(input.path);
  const language = languageFilter(input.language);
  const ref = requestedRef(input.ref);
  const includeHistory = optionalBoolean(input.includeHistory, 'include_history');
  const snapshot = await resolveSnapshot(request, env, fetcher, repositoryName, ref);
  const query = buildCodeSearchQuery(repositoryName, searchTerms, path, language);
  const search = await readData(
    request,
    env,
    fetcher,
    `/search/code?q=${encodeURIComponent(query)}&per_page=${limit}`,
  );
  if (!isObject(search) || !Array.isArray(search.items)) {
    throw new InvestigationError('invalid_code_search_response', 502);
  }

  const repo = repoPath(repositoryName);
  const items = search.items.slice(0, limit);
  const files = await Promise.all(
    items.map(async (raw) => {
      if (!isObject(raw) || typeof raw.path !== 'string') return null;
      const contentResponse = await readResponse(
        request,
        env,
        fetcher,
        `/repos/${repo}/contents/${filePath(raw.path)}?ref=${encodeURIComponent(snapshot.resolvedSha)}`,
      );
      if (contentResponse.status === 404) {
        return {
          path: raw.path,
          searchSha: stringValue(raw.sha),
          contentSha: null,
          searchHtmlUrl: stringValue(raw.html_url),
          size: null,
          snippets: [],
          contentAvailable: false,
          missingAtRef: true,
          history: [],
        };
      }
      const contentRaw = (await actionPayload(contentResponse)).data;
      const content = decodeContent(contentRaw);
      const historyRaw = includeHistory
        ? await readData(
            request,
            env,
            fetcher,
            `/repos/${repo}/commits?path=${encodeURIComponent(raw.path)}&sha=${encodeURIComponent(snapshot.resolvedSha)}&per_page=3`,
          )
        : [];
      const history = Array.isArray(historyRaw)
        ? historyRaw
            .map(compactHistory)
            .filter((entry): entry is JsonObject => Boolean(entry))
        : [];
      return {
        path: raw.path,
        searchSha: stringValue(raw.sha),
        contentSha: isObject(contentRaw) ? stringValue(contentRaw.sha) : null,
        searchHtmlUrl: stringValue(raw.html_url),
        size: isObject(contentRaw) ? numberValue(contentRaw.size) : null,
        snippets: content ? buildCodeSnippets(content, searchTerms) : [],
        contentAvailable: content !== null,
        missingAtRef: false,
        history,
      };
    }),
  );

  return json({
    ok: true,
    repository: {
      name: repositoryName,
      defaultBranch: snapshot.defaultBranch,
      searchIndexedBranch: snapshot.defaultBranch,
      requestedRef: snapshot.requestedRef,
      resolvedRefSha: snapshot.resolvedSha,
    },
    filters: { path: path ?? null, language: language ?? null },
    terms: searchTerms,
    totalCount: numberValue(search.total_count),
    incompleteResults: search.incomplete_results === true,
    note:
      snapshot.requestedRef === snapshot.defaultBranch
        ? null
        : 'GitHub code search seeds paths from the default-branch index; file content is fetched from the requested snapshot.',
    files: files.filter((file): file is NonNullable<typeof file> => Boolean(file)),
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

export function addInvestigationOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[CODE_INVESTIGATION_PATH] = {
    post: {
      operationId: 'investigateCode',
      summary: 'Search code and return useful snippets',
      description:
        'Searches the default-branch code index, then fetches matches from an optional branch, tag or SHA snapshot. Supports path/language filters and recent file history.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository', 'terms'],
              properties: {
                repository: { type: 'string', example: 'trvny/feedseek' },
                terms: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
                maxFiles: { type: 'integer', minimum: 1, maximum: 6 },
                path: { type: 'string', example: 'src' },
                language: { type: 'string', example: 'TypeScript' },
                ref: { type: 'string', description: 'Branch, tag or exact commit SHA for fetched content.' },
                includeHistory: { type: 'boolean' },
              },
            },
          },
        },
      },
      responses: objectResponse('Code investigation results'),
    },
  };
}

export async function handleInvestigationAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== CODE_INVESTIGATION_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await investigateCode(request, env, fetcher);
  } catch (error) {
    if (error instanceof InvestigationError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        gptInvestigation: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'investigation_internal_error' }, 500);
  }
}
