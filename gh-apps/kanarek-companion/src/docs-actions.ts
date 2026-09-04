const INDEX_PATH = '/gpt-actions/docs/index';
const SEARCH_PATH = '/gpt-actions/docs/search';
const GET_PATH = '/gpt-actions/docs/get';
const READ_PATH = '/gpt-actions/github/read';
const EXPECTED_OPERATOR = 'trvny';
const EXPECTED_OWNER = 'trvny';
const MAX_REQUEST_BYTES = 24_000;
const MAX_DOC_BYTES = 192_000;
const MAX_INDEX_LIMIT = 160;
const MAX_SEARCH_LIMIT = 10;

type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;

class DocsActionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'DocsActionError';
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

function internalReadRequest(source: Request, path: string): Request {
  const url = new URL(source.url);
  url.pathname = READ_PATH;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path }),
  });
}

async function responseObject(response: Response): Promise<JsonObject | null> {
  try {
    const value: unknown = await response.clone().json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function authorizeOperator(request: Request, invoke: Invoke): Promise<Response | null> {
  const response = await invoke(internalReadRequest(request, '/user'));
  if (!response.ok) return response;
  const payload = await responseObject(response);
  const data = payload && isObject(payload.data) ? payload.data : null;
  if (!payload || payload.ok !== true || data?.login !== EXPECTED_OPERATOR) {
    return json({ ok: false, error: 'operator_not_allowed' }, 403);
  }
  return null;
}

async function githubRead(request: Request, invoke: Invoke, path: string): Promise<unknown> {
  const response = await invoke(internalReadRequest(request, path));
  const payload = await responseObject(response);
  if (!response.ok || !payload || payload.ok !== true) {
    const code = typeof payload?.error === 'string' ? payload.error : 'docs_github_read_failed';
    throw new DocsActionError(code, response.status >= 400 ? response.status : 502);
  }
  return payload.data;
}

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > MAX_REQUEST_BYTES) throw new DocsActionError('payload_too_large', 413);
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DocsActionError('invalid_json');
  }
  if (!isObject(value)) throw new DocsActionError('invalid_json_object');
  return value;
}

function stringValue(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new DocsActionError(`invalid_${name}`);
  }
  return value.trim();
}

function repositoryValue(value: unknown): string {
  const repository = stringValue(value, 'repository', 200);
  const [owner, repo, extra] = repository.split('/');
  if (
    extra ||
    owner !== EXPECTED_OWNER ||
    !repo ||
    !/^[A-Za-z0-9_.-]+$/.test(repo)
  ) {
    throw new DocsActionError('repository_not_allowed', 403);
  }
  return `${owner}/${repo}`;
}

function filePathValue(value: unknown): string {
  const path = stringValue(value, 'path', 1_000);
  const parts = path.split('/');
  if (
    path.startsWith('/') ||
    path.endsWith('/') ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    parts[0] === '.git'
  ) {
    throw new DocsActionError('invalid_path');
  }
  if (!isDocumentationPath(path)) throw new DocsActionError('documentation_path_not_allowed', 403);
  return path;
}

function refValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const ref = stringValue(value, 'ref', 250);
  if (ref.startsWith('/') || ref.endsWith('/') || ref.includes('..') || ref.includes('//')) {
    throw new DocsActionError('invalid_ref');
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(ref)) throw new DocsActionError('invalid_ref');
  return ref;
}

function boundedInteger(value: unknown, name: string, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new DocsActionError(`invalid_${name}`);
  }
  return value;
}

function repoPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function contentPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function isDocumentationPath(path: string): boolean {
  const lower = path.toLowerCase();
  const base = lower.split('/').at(-1) ?? lower;
  const docsDirectory = /(^|\/)(docs?|reference)\//.test(lower);
  if (base === 'llms.txt' || base === 'llms-full.txt') return true;
  if (base.startsWith('readme.')) return /\.(md|mdx|txt|rst|adoc)$/.test(base);
  if (/\.(md|mdx|rst|adoc)$/.test(lower)) return true;
  if (/\.txt$/.test(lower)) return docsDirectory;
  if (/\.(ya?ml|json)$/.test(lower)) {
    return /(^|\/)(openapi|swagger|asyncapi|schema)([._-]|$)/.test(lower) || docsDirectory;
  }
  return false;
}

function defaultBranch(data: unknown): string {
  if (!isObject(data) || typeof data.default_branch !== 'string' || !data.default_branch) {
    throw new DocsActionError('invalid_repository_response', 502);
  }
  return data.default_branch;
}

function decodeBase64Utf8(value: string): string {
  let binary: string;
  try {
    binary = atob(value.replace(/\s+/g, ''));
  } catch {
    throw new DocsActionError('invalid_document_encoding', 502);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new DocsActionError('invalid_document_encoding', 502);
  }
}

async function resolveRef(
  request: Request,
  invoke: Invoke,
  repository: string,
  ref: string | null,
): Promise<string> {
  if (ref) return ref;
  const metadata = await githubRead(request, invoke, `/repos/${repoPath(repository)}`);
  return defaultBranch(metadata);
}

async function indexAction(request: Request, invoke: Invoke, input: JsonObject): Promise<Response> {
  const repository = repositoryValue(input.repository);
  const limit = boundedInteger(input.limit, 'limit', 80, MAX_INDEX_LIMIT);
  const metadata = await githubRead(request, invoke, `/repos/${repoPath(repository)}`);
  const ref = defaultBranch(metadata);
  const tree = await githubRead(
    request,
    invoke,
    `/repos/${repoPath(repository)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  if (!isObject(tree) || !Array.isArray(tree.tree)) {
    throw new DocsActionError('invalid_docs_tree_response', 502);
  }
  const documents = tree.tree.flatMap((entry): JsonObject[] => {
    if (!isObject(entry) || entry.type !== 'blob' || typeof entry.path !== 'string') return [];
    if (!isDocumentationPath(entry.path)) return [];
    const size = typeof entry.size === 'number' ? entry.size : null;
    return [{
      path: entry.path,
      sha: typeof entry.sha === 'string' ? entry.sha : null,
      size,
      readable: size === null || size <= MAX_DOC_BYTES,
    }];
  }).sort((left, right) => String(left.path).localeCompare(String(right.path)));
  const visible = documents.slice(0, limit);
  return json({
    ok: true,
    source: 'github',
    repository,
    ref,
    documentCount: documents.length,
    truncated: tree.truncated === true || documents.length > visible.length,
    documents: visible,
    discoveryHints: visible
      .filter((entry) => entry.path === 'llms.txt' || entry.path === 'llms-full.txt')
      .map((entry) => entry.path),
  });
}

async function getDocAction(request: Request, invoke: Invoke, input: JsonObject): Promise<Response> {
  const repository = repositoryValue(input.repository);
  const path = filePathValue(input.path);
  const ref = await resolveRef(request, invoke, repository, refValue(input.ref));
  const data = await githubRead(
    request,
    invoke,
    `/repos/${repoPath(repository)}/contents/${contentPath(path)}?ref=${encodeURIComponent(ref)}`,
  );
  if (!isObject(data) || data.type !== 'file') throw new DocsActionError('document_not_found', 404);
  const size = typeof data.size === 'number' ? data.size : null;
  if (size !== null && size > MAX_DOC_BYTES) throw new DocsActionError('document_too_large', 413);
  if (data.encoding !== 'base64' || typeof data.content !== 'string') {
    throw new DocsActionError('document_content_unavailable', 502);
  }
  const content = decodeBase64Utf8(data.content);
  if (new TextEncoder().encode(content).byteLength > MAX_DOC_BYTES) {
    throw new DocsActionError('document_too_large', 413);
  }
  return json({
    ok: true,
    source: 'github',
    repository,
    path,
    ref,
    sha: typeof data.sha === 'string' ? data.sha : null,
    size,
    content,
    htmlUrl: typeof data.html_url === 'string' ? data.html_url : null,
  });
}

function searchRepository(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return repositoryValue(value);
}

async function searchAction(request: Request, invoke: Invoke, input: JsonObject): Promise<Response> {
  const query = stringValue(input.query, 'query', 300).replace(/[\r\n\0]+/g, ' ').trim();
  if (!query) throw new DocsActionError('invalid_query');
  const repository = searchRepository(input.repository);
  const limit = boundedInteger(input.limit, 'limit', 6, MAX_SEARCH_LIMIT);
  const scope = repository ? `repo:${repository}` : `user:${EXPECTED_OWNER}`;
  const search = `${query} ${scope}`;
  const data = await githubRead(
    request,
    invoke,
    `/search/code?q=${encodeURIComponent(search)}&per_page=100`,
  );
  if (!isObject(data) || !Array.isArray(data.items)) {
    throw new DocsActionError('invalid_docs_search_response', 502);
  }
  const matches: JsonObject[] = [];
  const seen = new Set<string>();
  for (const item of data.items) {
    if (!isObject(item) || typeof item.path !== 'string' || !isDocumentationPath(item.path)) continue;
    const repositoryData = isObject(item.repository) ? item.repository : null;
    const fullName = repositoryData && typeof repositoryData.full_name === 'string'
      ? repositoryData.full_name
      : null;
    if (!fullName?.startsWith(`${EXPECTED_OWNER}/`)) continue;
    if (repository && fullName !== repository) continue;
    const key = `${fullName}:${item.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push({
      repository: fullName,
      path: item.path,
      name: typeof item.name === 'string' ? item.name : null,
      blobSha: typeof item.sha === 'string' ? item.sha : null,
      htmlUrl: typeof item.html_url === 'string' ? item.html_url : null,
    });
    if (matches.length >= limit) break;
  }
  return json({
    ok: true,
    source: 'github-code-search',
    query,
    repository,
    matchCount: matches.length,
    incompleteResults: data.incomplete_results === true,
    matches,
  });
}

export async function handleDocsAction(
  request: Request,
  invoke: Invoke,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (![INDEX_PATH, SEARCH_PATH, GET_PATH].includes(pathname)) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  const unauthorized = await authorizeOperator(request, invoke);
  if (unauthorized) return unauthorized;

  try {
    const input = await inputObject(request);
    if (pathname === INDEX_PATH) return await indexAction(request, invoke, input);
    if (pathname === SEARCH_PATH) return await searchAction(request, invoke, input);
    return await getDocAction(request, invoke, input);
  } catch (error) {
    if (error instanceof DocsActionError) return json({ ok: false, error: error.code }, error.status);
    console.error(JSON.stringify({ docsActions: 'failed', error: error instanceof Error ? error.message : 'unknown_error' }));
    return json({ ok: false, error: 'internal_error' }, 500);
  }
}

function requestSchema(properties: JsonObject, required: string[]): JsonObject {
  return {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required,
          properties,
          additionalProperties: false,
        },
      },
    },
  };
}

export function addDocsOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  const responses = {
    '200': {
      description: 'Successful live documentation lookup',
      content: { 'application/json': { schema: { type: 'object' } } },
    },
  };
  const security = [{ githubOAuth: [] }];

  paths[INDEX_PATH] = {
    post: {
      operationId: 'getDocsIndex',
      summary: 'List live documentation files for a trvny repository',
      description: 'Reads the repository default branch and returns bounded documentation paths from the GitHub source of truth. Use this when the relevant document is unknown.',
      security,
      requestBody: requestSchema({
        repository: { type: 'string', example: 'trvny/trvny' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_INDEX_LIMIT, default: 80 },
      }, ['repository']),
      responses,
    },
  };
  paths[SEARCH_PATH] = {
    post: {
      operationId: 'searchDocs',
      summary: 'Search live documentation in trvny repositories',
      description: 'Searches current GitHub code, filters results to documentation-like files, and returns exact repository/path matches. Call getDoc for the selected result instead of relying on model memory.',
      security,
      requestBody: requestSchema({
        query: { type: 'string' },
        repository: { type: 'string', description: 'Optional trvny/name scope; omit to search across trvny repositories.' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_SEARCH_LIMIT, default: 6 },
      }, ['query']),
      responses,
    },
  };
  paths[GET_PATH] = {
    post: {
      operationId: 'getDoc',
      summary: 'Fetch one live documentation file from GitHub',
      description: 'Returns one bounded UTF-8 documentation file from a trvny repository. Omit ref to read the current default branch, or pin a branch/tag/SHA when exact snapshot consistency matters.',
      security,
      requestBody: requestSchema({
        repository: { type: 'string', example: 'trvny/trvny' },
        path: { type: 'string', example: 'README.md' },
        ref: { type: 'string' },
      }, ['repository', 'path']),
      responses,
    },
  };
}
