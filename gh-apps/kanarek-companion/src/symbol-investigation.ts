export const SYMBOL_INVESTIGATION_PATH = '/gpt-actions/github/code/symbol';

const READ_PATH = '/gpt-actions/github/read';
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_CONTENT_BYTES = 400_000;
const MAX_OCCURRENCES_PER_FILE = 30;

type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;
type SymbolKind = 'definition' | 'import' | 'implementation' | 'reference';
type Confidence = 'high' | 'medium';

type Input = {
  repository: string;
  symbol: string;
  maxFiles: number;
  path?: string;
  language?: string;
  ref?: string;
};

export interface SymbolOccurrence {
  line: number;
  kind: SymbolKind;
  confidence: Confidence;
  text: string;
  context: string;
}

class SymbolInvestigationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'SymbolInvestigationError';
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
    throw new SymbolInvestigationError('repository_not_allowed', 403);
  }
  return value;
}

export function symbolAllowed(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 2 &&
    value.length <= 128 &&
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)
  );
}

function symbol(value: unknown): string {
  if (!symbolAllowed(value)) throw new SymbolInvestigationError('invalid_symbol');
  return value;
}

function optionalPath(value: unknown): string | undefined {
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
    throw new SymbolInvestigationError('invalid_path');
  }
  return value;
}

function optionalLanguage(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 40 ||
    !/^[A-Za-z0-9#+._-]+$/.test(value)
  ) {
    throw new SymbolInvestigationError('invalid_language');
  }
  return value;
}

export function symbolRefAllowed(value: unknown): value is string {
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
  if (!symbolRefAllowed(value)) throw new SymbolInvestigationError('invalid_ref');
  return value;
}

function maxFiles(value: unknown): number {
  if (value === undefined) return 8;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 12) {
    throw new SymbolInvestigationError('invalid_max_files');
  }
  return value;
}

async function inputObject(request: Request): Promise<Input> {
  const text = await request.clone().text();
  if (text.length > 16_000) throw new SymbolInvestigationError('payload_too_large', 413);
  let value: unknown = {};
  try {
    if (text.trim()) value = JSON.parse(text);
  } catch {
    throw new SymbolInvestigationError('invalid_json');
  }
  if (!isObject(value)) throw new SymbolInvestigationError('invalid_json_object');
  const allowed = new Set(['repository', 'symbol', 'maxFiles', 'path', 'language', 'ref']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new SymbolInvestigationError('invalid_symbol_request');
  }
  return {
    repository: repository(value.repository),
    symbol: symbol(value.symbol),
    maxFiles: maxFiles(value.maxFiles),
    path: optionalPath(value.path),
    language: optionalLanguage(value.language),
    ref: optionalRef(value.ref),
  };
}

function internalRequest(source: Request, path: string): Request {
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

async function responseObject(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new SymbolInvestigationError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new SymbolInvestigationError('invalid_action_response', 502);
  if (!response.ok || value.ok !== true) {
    throw new SymbolInvestigationError(
      typeof value.error === 'string' ? value.error : `read_${response.status}`,
      response.status,
    );
  }
  return value;
}

async function readData(source: Request, invoke: Invoke, path: string): Promise<unknown> {
  return (await responseObject(await invoke(internalRequest(source, path)))).data;
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

function hasSymbol(line: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`).test(line);
}

export function likelyTestPath(path: string): boolean {
  const normalized = `/${path.toLowerCase()}`;
  return (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/') ||
    normalized.includes('/androidtest/') ||
    normalized.includes('/testfixtures/') ||
    /\.(?:test|spec)\.[^.\/]+$/.test(normalized) ||
    /(?:test|tests)\.(?:kt|java|swift|go|rs|py)$/.test(normalized)
  );
}

function definitionConfidence(line: string, name: string): Confidence | null {
  const escaped = escapeRegExp(name);
  const declarations = [
    new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function|class|interface|type|enum|const|let|var|namespace)\\s+${escaped}\\b`),
    new RegExp(`^\\s*(?:(?:public|private|protected|internal|open|final|abstract|sealed|data|enum|annotation|value|inline|suspend|operator|override|static)\\s+)*(?:class|interface|object|fun|typealias|val|var)\\s+${escaped}\\b`),
    new RegExp(`^\\s*(?:async\\s+)?(?:def|class)\\s+${escaped}\\b`),
    new RegExp(`^\\s*(?:func|type|var|const)\\s+(?:\\([^)]*\\)\\s+)?${escaped}\\b`),
    new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:fn|struct|enum|trait|type|const|static|mod)\\s+${escaped}\\b`),
    new RegExp(`^\\s*(?:(?:public|private|internal|fileprivate|open|final|static|class|override)\\s+)*(?:func|class|struct|enum|protocol|typealias|let|var)\\s+${escaped}\\b`),
  ];
  if (declarations.some((pattern) => pattern.test(line))) return 'high';

  const method = new RegExp(
    `^\\s*(?:(?:public|private|protected|internal|static|final|override|open|abstract|async|suspend|inline|operator)\\s+)+${escaped}\\s*(?:<[^>]*>\\s*)?\\(`,
  );
  return method.test(line) ? 'medium' : null;
}

function isImportLine(line: string, name: string): boolean {
  if (!hasSymbol(line, name)) return false;
  return (
    /^\s*import\b/.test(line) ||
    /^\s*from\b.+\bimport\b/.test(line) ||
    /\bfrom\s+['"][^'"]+['"]/.test(line) ||
    /\brequire\s*\(/.test(line)
  );
}

function isImplementationLine(line: string, name: string): boolean {
  if (!hasSymbol(line, name)) return false;
  const escaped = escapeRegExp(name);
  return (
    new RegExp(`\\b(?:implements|extends)\\b[^\\n]*\\b${escaped}\\b`).test(line) ||
    new RegExp(`^\\s*(?:class|interface|object|struct)\\b[^\\n]*:\\s*[^\\n]*\\b${escaped}\\b`).test(line) ||
    new RegExp(`^\\s*impl(?:<[^>]+>)?\\s+${escaped}\\b`).test(line) ||
    new RegExp(`^\\s*impl(?:<[^>]+>)?\\s+[^\\n]+\\s+for\\s+${escaped}\\b`).test(line)
  );
}

export function classifySymbolLine(
  line: string,
  name: string,
): { kind: SymbolKind; confidence: Confidence } | null {
  if (!hasSymbol(line, name)) return null;
  const confidence = definitionConfidence(line, name);
  if (confidence) return { kind: 'definition', confidence };
  if (isImportLine(line, name)) return { kind: 'import', confidence: 'high' };
  if (isImplementationLine(line, name)) return { kind: 'implementation', confidence: 'medium' };
  return { kind: 'reference', confidence: 'medium' };
}

function occurrenceContext(lines: string[], index: number): string {
  const start = Math.max(0, index - 1);
  const end = Math.min(lines.length - 1, index + 1);
  return lines
    .slice(start, end + 1)
    .map((line, offset) => `${start + offset + 1}: ${line}`)
    .join('\n')
    .slice(0, 2_500);
}

export function symbolOccurrences(content: string, name: string): SymbolOccurrence[] {
  const lines = content.split(/\r?\n/);
  const occurrences: SymbolOccurrence[] = [];
  for (let index = 0; index < lines.length && occurrences.length < MAX_OCCURRENCES_PER_FILE; index += 1) {
    const classified = classifySymbolLine(lines[index], name);
    if (!classified) continue;
    occurrences.push({
      line: index + 1,
      kind: classified.kind,
      confidence: classified.confidence,
      text: lines[index].trim().slice(0, 800),
      context: occurrenceContext(lines, index),
    });
  }
  return occurrences;
}

function compactOccurrence(path: string, testFile: boolean, occurrence: SymbolOccurrence): JsonObject {
  return {
    path,
    testFile,
    line: occurrence.line,
    kind: occurrence.kind,
    confidence: occurrence.confidence,
    text: occurrence.text,
    context: occurrence.context,
  };
}

function searchQuery(input: Input): string {
  return [
    input.symbol,
    `repo:${input.repository}`,
    ...(input.path ? [`path:${input.path}`] : []),
    ...(input.language ? [`language:${input.language}`] : []),
  ].join(' ');
}

async function resolveSnapshot(
  source: Request,
  invoke: Invoke,
  input: Input,
): Promise<{ defaultBranch: string; requestedRef: string; resolvedSha: string }> {
  const repo = repoPath(input.repository);
  const repositoryRaw = await readData(source, invoke, `/repos/${repo}`);
  if (!isObject(repositoryRaw) || typeof repositoryRaw.default_branch !== 'string') {
    throw new SymbolInvestigationError('invalid_repository_response', 502);
  }
  const requestedRef = input.ref ?? repositoryRaw.default_branch;
  const commitRaw = await readData(
    source,
    invoke,
    `/repos/${repo}/commits/${encodeURIComponent(requestedRef)}`,
  );
  if (!isObject(commitRaw) || typeof commitRaw.sha !== 'string' || !SHA_RE.test(commitRaw.sha)) {
    throw new SymbolInvestigationError('invalid_ref_response', 502);
  }
  return {
    defaultBranch: repositoryRaw.default_branch,
    requestedRef,
    resolvedSha: commitRaw.sha.toLowerCase(),
  };
}

async function investigateSymbol(source: Request, invoke: Invoke): Promise<Response> {
  const input = await inputObject(source);
  const snapshot = await resolveSnapshot(source, invoke, input);
  const query = searchQuery(input);
  const searchRaw = await readData(
    source,
    invoke,
    `/search/code?q=${encodeURIComponent(query)}&per_page=${Math.min(20, input.maxFiles * 2)}`,
  );
  if (!isObject(searchRaw) || !Array.isArray(searchRaw.items)) {
    throw new SymbolInvestigationError('invalid_code_search_response', 502);
  }

  const repo = repoPath(input.repository);
  const candidates = searchRaw.items
    .filter((item): item is JsonObject => isObject(item) && typeof item.path === 'string')
    .slice(0, input.maxFiles);

  const files = await Promise.all(
    candidates.map(async (item) => {
      const path = String(item.path);
      const contentRaw = await readData(
        source,
        invoke,
        `/repos/${repo}/contents/${filePath(path)}?ref=${encodeURIComponent(snapshot.resolvedSha)}`,
      ).catch((error) => {
        if (error instanceof SymbolInvestigationError && error.status === 404) return null;
        throw error;
      });
      if (!contentRaw) {
        return {
          path,
          testFile: likelyTestPath(path),
          contentAvailable: false,
          missingAtRef: true,
          occurrences: [],
        };
      }
      const content = decodeContent(contentRaw);
      const occurrences = content ? symbolOccurrences(content, input.symbol) : [];
      return {
        path,
        testFile: likelyTestPath(path),
        contentAvailable: content !== null,
        missingAtRef: false,
        contentSha: isObject(contentRaw) ? stringValue(contentRaw.sha) : null,
        size: isObject(contentRaw) ? numberValue(contentRaw.size) : null,
        searchHtmlUrl: stringValue(item.html_url),
        occurrences,
      };
    }),
  );

  const flattened = files.flatMap((file) =>
    file.occurrences.map((occurrence) => compactOccurrence(file.path, file.testFile, occurrence)),
  );
  const definitions = flattened.filter((item) => item.kind === 'definition');
  const imports = flattened.filter((item) => item.kind === 'import');
  const implementations = flattened.filter((item) => item.kind === 'implementation');
  const references = flattened.filter((item) => item.kind === 'reference');
  const tests = flattened.filter((item) => item.testFile === true);

  return json({
    ok: true,
    repository: {
      name: input.repository,
      defaultBranch: snapshot.defaultBranch,
      searchIndexedBranch: snapshot.defaultBranch,
      requestedRef: snapshot.requestedRef,
      resolvedRefSha: snapshot.resolvedSha,
    },
    symbol: input.symbol,
    filters: {
      path: input.path ?? null,
      language: input.language ?? null,
      maxFiles: input.maxFiles,
    },
    totalCount: numberValue(searchRaw.total_count),
    incompleteResults: searchRaw.incomplete_results === true,
    summary: {
      files: files.length,
      occurrences: flattened.length,
      definitions: definitions.length,
      imports: imports.length,
      implementations: implementations.length,
      references: references.length,
      testOccurrences: tests.length,
    },
    definitions,
    imports,
    implementations,
    references,
    tests,
    files,
    note:
      snapshot.requestedRef === snapshot.defaultBranch
        ? 'Classification is heuristic and intentionally conservative; use snippets as evidence.'
        : 'GitHub code search seeds paths from the default-branch index; content and classification are pinned to the requested snapshot.',
  });
}

function objectResponse(description: string): JsonObject {
  return {
    description,
    content: {
      'application/json': {
        schema: { type: 'object', properties: {} },
      },
    },
  };
}

export function addSymbolInvestigationOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[SYMBOL_INVESTIGATION_PATH] = {
    post: {
      operationId: 'investigateSymbol',
      summary: 'Trace a code symbol through definitions and references',
      description:
        'Finds a named symbol, pins matching file content to an exact repository snapshot, classifies definitions/imports/implementations/references, and surfaces matching tests.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository', 'symbol'],
              properties: {
                repository: { type: 'string', example: 'trvny/feedseek' },
                symbol: { type: 'string', example: 'FeedRepository' },
                maxFiles: { type: 'integer', minimum: 1, maximum: 12, default: 8 },
                path: { type: 'string', example: 'src' },
                language: { type: 'string', example: 'Kotlin' },
                ref: {
                  type: 'string',
                  description: 'Branch, tag or exact commit SHA for fetched content.',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': objectResponse('Symbol investigation result'),
        '400': objectResponse('Invalid request'),
      },
    },
  };
}

export async function handleSymbolInvestigationAction(
  request: Request,
  invoke: Invoke,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== SYMBOL_INVESTIGATION_PATH) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    return await investigateSymbol(request, invoke);
  } catch (error) {
    if (error instanceof SymbolInvestigationError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        symbolInvestigation: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'symbol_investigation_internal_error' }, 500);
  }
}
