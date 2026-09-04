import { likelyTestPath } from './symbol-investigation.ts';

export const DEPENDENCY_GRAPH_PATH = '/gpt-actions/github/code/dependencies';

const READ_PATH = '/gpt-actions/github/read';
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_CONTENT_BYTES = 500_000;
const MAX_IMPORTS = 80;
const MAX_CALLERS = 12;
const MAX_CANDIDATES = 40;

type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;
type ImportSyntax = 'module' | 'python' | 'rust';
type Confidence = 'high' | 'medium';

type Input = {
  repository: string;
  path: string;
  ref?: string;
  maxCallers: number;
  maxCandidates: number;
};

export type ImportEvidence = {
  line: number;
  specifier: string;
  syntax: ImportSyntax;
  local: boolean;
  text: string;
};

class DependencyGraphError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'DependencyGraphError';
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
    throw new DependencyGraphError('repository_not_allowed', 403);
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
    throw new DependencyGraphError('invalid_path');
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
  if (!refAllowed(value)) throw new DependencyGraphError('invalid_ref');
  return value;
}

function maxCallers(value: unknown): number {
  if (value === undefined) return 8;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_CALLERS) {
    throw new DependencyGraphError('invalid_max_callers');
  }
  return value;
}

function maxCandidates(value: unknown, callerLimit: number): number {
  if (value === undefined) return Math.min(MAX_CANDIDATES, Math.max(12, callerLimit * 3));
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_CANDIDATES) {
    throw new DependencyGraphError('invalid_max_candidates');
  }
  return value;
}

async function inputObject(request: Request): Promise<Input> {
  const text = await request.clone().text();
  if (text.length > 16_000) throw new DependencyGraphError('payload_too_large', 413);
  let value: unknown = {};
  try {
    if (text.trim()) value = JSON.parse(text);
  } catch {
    throw new DependencyGraphError('invalid_json');
  }
  if (!isObject(value)) throw new DependencyGraphError('invalid_json_object');
  const allowed = new Set(['repository', 'path', 'ref', 'maxCallers', 'maxCandidates']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new DependencyGraphError('invalid_dependency_graph_request');
  }
  const callerLimit = maxCallers(value.maxCallers);
  return {
    repository: repository(value.repository),
    path: pathValue(value.path),
    ref: optionalRef(value.ref),
    maxCallers: callerLimit,
    maxCandidates: maxCandidates(value.maxCandidates, callerLimit),
  };
}

function internalRequest(source: Request, path: string): Request {
  const url = new URL(source.url);
  url.pathname = READ_PATH;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, { method: 'POST', headers, body: JSON.stringify({ path }) });
}

async function responseObject(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new DependencyGraphError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new DependencyGraphError('invalid_action_response', 502);
  if (!response.ok || value.ok !== true) {
    throw new DependencyGraphError(
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

function localSpecifier(value: string): boolean {
  return value.startsWith('.') || /^(?:crate|self|super)::/.test(value);
}

function pushImport(
  output: ImportEvidence[],
  seen: Set<string>,
  line: number,
  specifier: string,
  syntax: ImportSyntax,
  text: string,
): void {
  const cleaned = specifier.trim().replace(/[;,]$/, '');
  if (!cleaned) return;
  const key = `${line}:${syntax}:${cleaned}`;
  if (seen.has(key)) return;
  seen.add(key);
  output.push({
    line,
    specifier: cleaned,
    syntax,
    local: localSpecifier(cleaned),
    text: text.trim().slice(0, 600),
  });
}

export function extractImports(content: string, limit = MAX_IMPORTS): ImportEvidence[] {
  const output: ImportEvidence[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length && output.length < limit; index += 1) {
    const text = lines[index];
    const line = index + 1;
    const quoted = [
      /\bfrom\s+['"]([^'"]+)['"]/g,
      /^\s*import\s+['"]([^'"]+)['"]/g,
      /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /^\s*import\s+(?:[A-Za-z_$][\w$]*\s+)?['"]([^'"]+)['"]/g,
    ];
    for (const pattern of quoted) {
      for (const match of text.matchAll(pattern)) {
        pushImport(output, seen, line, match[1], 'module', text);
        if (output.length >= limit) break;
      }
      if (output.length >= limit) break;
    }
    if (output.length >= limit) break;

    const pythonFrom = text.match(/^\s*from\s+([.A-Za-z0-9_]+)\s+import\b/);
    if (pythonFrom) {
      pushImport(output, seen, line, pythonFrom[1], 'python', text);
      continue;
    }
    const plainImport = text.match(/^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;?/);
    if (plainImport && !/\bfrom\s+['"]/.test(text) && !/=\s*require\s*\(/.test(text)) {
      pushImport(output, seen, line, plainImport[1], 'python', text);
      continue;
    }
    const rustUse = text.match(/^\s*(?:pub\s+)?use\s+([^;]+);?/);
    if (rustUse) pushImport(output, seen, line, rustUse[1], 'rust', text);
  }

  return output.slice(0, limit);
}

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function dirname(value: string): string {
  const normalized = normalizePath(value);
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '' : normalized.slice(0, slash);
}

function stripExtension(value: string): string {
  return value.replace(/\.(?:d\.ts|tsx?|jsx?|mjs|cjs|json|kt|kts|java|swift|py|go|rs)$/i, '');
}

function targetVariants(targetPath: string): string[] {
  const stripped = stripExtension(normalizePath(targetPath));
  const variants = new Set([stripped]);
  if (stripped.endsWith('/index')) variants.add(stripped.slice(0, -'/index'.length));
  if (stripped.endsWith('/__init__')) variants.add(stripped.slice(0, -'/__init__'.length));
  if (stripped.endsWith('/mod')) variants.add(stripped.slice(0, -'/mod'.length));
  return [...variants].filter(Boolean);
}

function relativePythonPath(callerPath: string, specifier: string): string {
  const dots = specifier.match(/^\.+/)?.[0].length ?? 0;
  let base = dirname(callerPath);
  for (let index = 1; index < dots; index += 1) base = dirname(base);
  const tail = specifier.slice(dots).replace(/\./g, '/');
  return normalizePath([base, tail].filter(Boolean).join('/'));
}

function exactMatches(candidate: string, variants: string[]): boolean {
  return Boolean(candidate) && variants.includes(candidate);
}

function suffixMatches(candidate: string, variants: string[]): boolean {
  if (!candidate) return false;
  return variants.some(
    (variant) =>
      candidate === variant ||
      candidate.endsWith(`/${variant}`) ||
      variant.endsWith(`/${candidate}`),
  );
}

function sourceRoot(path: string): string | null {
  const normalized = normalizePath(path);
  if (normalized.startsWith('src/')) return 'src/';
  const marker = normalized.lastIndexOf('/src/');
  return marker >= 0 ? normalized.slice(0, marker + '/src/'.length) : null;
}

function rustCrateModule(callerPath: string, targetPath: string): string | null {
  const root = sourceRoot(callerPath);
  if (!root) return null;
  let target = stripExtension(normalizePath(targetPath));
  if (!target.startsWith(root)) return null;
  target = target.slice(root.length);
  if (target.endsWith('/mod')) target = target.slice(0, -'/mod'.length);
  return target || null;
}

function rustRelativeMatches(candidate: string, variants: string[]): boolean {
  const normalized = stripExtension(normalizePath(candidate));
  return variants.some(
    (variant) => normalized === variant || normalized.startsWith(`${variant}/`),
  );
}

export function importReferencesTarget(
  callerPath: string,
  specifier: string,
  targetPath: string,
  syntax: ImportSyntax = 'module',
): Confidence | null {
  const variants = targetVariants(targetPath);
  if (!variants.length) return null;
  const cleaned = specifier.replace(/[?#].*$/, '').trim();

  if (syntax === 'module' && cleaned.startsWith('.')) {
    const resolved = stripExtension(normalizePath(`${dirname(callerPath)}/${cleaned}`));
    return exactMatches(resolved, variants) ? 'high' : null;
  }

  if (syntax === 'python') {
    const relative = cleaned.startsWith('.');
    const resolved = relative
      ? relativePythonPath(callerPath, cleaned)
      : cleaned.replace(/\./g, '/');
    const matches = relative
      ? exactMatches(stripExtension(resolved), variants)
      : suffixMatches(stripExtension(resolved), variants);
    return matches ? (relative ? 'high' : 'medium') : null;
  }

  if (syntax === 'rust') {
    let resolved = cleaned.replace(/[{}\s]/g, '').replace(/::/g, '/');
    if (resolved.startsWith('crate/')) {
      const imported = resolved.slice('crate/'.length);
      const targetModule = rustCrateModule(callerPath, targetPath);
      if (targetModule) {
        return imported === targetModule || imported.startsWith(`${targetModule}/`) ? 'medium' : null;
      }
      resolved = imported;
    } else if (resolved.startsWith('self/')) {
      resolved = `${dirname(callerPath)}/${resolved.slice('self/'.length)}`;
      return rustRelativeMatches(resolved, variants) ? 'medium' : null;
    } else if (resolved.startsWith('super/')) {
      resolved = `${dirname(dirname(callerPath))}/${resolved.slice('super/'.length)}`;
      return rustRelativeMatches(resolved, variants) ? 'medium' : null;
    }
    return suffixMatches(stripExtension(normalizePath(resolved)), variants) ? 'medium' : null;
  }

  const dotted = cleaned.replace(/\./g, '/');
  return suffixMatches(stripExtension(dotted), variants) ? 'medium' : null;
}

async function resolveSnapshot(
  source: Request,
  invoke: Invoke,
  input: Input,
): Promise<{ defaultBranch: string; requestedRef: string; resolvedSha: string }> {
  const repo = repoPath(input.repository);
  const repositoryRaw = await readData(source, invoke, `/repos/${repo}`);
  if (!isObject(repositoryRaw) || typeof repositoryRaw.default_branch !== 'string') {
    throw new DependencyGraphError('invalid_repository_response', 502);
  }
  const requestedRef = input.ref ?? repositoryRaw.default_branch;
  const commitRaw = await readData(
    source,
    invoke,
    `/repos/${repo}/commits/${encodeURIComponent(requestedRef)}`,
  );
  if (!isObject(commitRaw) || typeof commitRaw.sha !== 'string' || !SHA_RE.test(commitRaw.sha)) {
    throw new DependencyGraphError('invalid_ref_response', 502);
  }
  return {
    defaultBranch: repositoryRaw.default_branch,
    requestedRef,
    resolvedSha: commitRaw.sha.toLowerCase(),
  };
}

export function searchSeed(path: string): string {
  const parts = normalizePath(path).split('/');
  const file = parts.at(-1) ?? path;
  const stem = stripExtension(file);
  const seed =
    (stem === 'index' || stem === '__init__' || stem === 'mod') && parts.length > 1
      ? parts[parts.length - 2]
      : stem;
  return seed.replace(/[^A-Za-z0-9_$.-]/g, '');
}

async function dependencyGraph(source: Request, invoke: Invoke): Promise<Response> {
  const input = await inputObject(source);
  const snapshot = await resolveSnapshot(source, invoke, input);
  const repo = repoPath(input.repository);
  const targetRaw = await readData(
    source,
    invoke,
    `/repos/${repo}/contents/${filePath(input.path)}?ref=${encodeURIComponent(snapshot.resolvedSha)}`,
  );
  const targetContent = decodeContent(targetRaw);
  if (targetContent === null) throw new DependencyGraphError('target_content_unavailable', 422);

  const directImports = extractImports(targetContent);
  const seed = searchSeed(input.path);
  if (!seed) throw new DependencyGraphError('invalid_search_seed');
  const candidateLimit = input.maxCandidates;
  const query = `${seed} repo:${input.repository}`;
  const searchRaw = await readData(
    source,
    invoke,
    `/search/code?q=${encodeURIComponent(query)}&per_page=${candidateLimit}`,
  );
  if (!isObject(searchRaw) || !Array.isArray(searchRaw.items)) {
    throw new DependencyGraphError('invalid_code_search_response', 502);
  }

  const candidates = searchRaw.items
    .filter((item): item is JsonObject => isObject(item) && typeof item.path === 'string')
    .filter((item) => normalizePath(String(item.path)) !== normalizePath(input.path))
    .slice(0, candidateLimit);

  const inspected = await Promise.all(
    candidates.map(async (item) => {
      const path = String(item.path);
      const raw = await readData(
        source,
        invoke,
        `/repos/${repo}/contents/${filePath(path)}?ref=${encodeURIComponent(snapshot.resolvedSha)}`,
      ).catch((error) => {
        if (error instanceof DependencyGraphError && error.status === 404) return null;
        throw error;
      });
      if (!raw) return null;
      const content = decodeContent(raw);
      if (content === null) return null;
      const matches = extractImports(content)
        .map((entry) => ({
          ...entry,
          confidence: importReferencesTarget(path, entry.specifier, input.path, entry.syntax),
        }))
        .filter((entry): entry is ImportEvidence & { confidence: Confidence } => entry.confidence !== null);
      if (!matches.length) return null;
      return {
        path,
        testFile: likelyTestPath(path),
        contentSha: isObject(raw) ? stringValue(raw.sha) : null,
        size: isObject(raw) ? numberValue(raw.size) : null,
        matches,
      };
    }),
  );

  const allCallers = inspected.filter((item): item is NonNullable<typeof item> => Boolean(item));
  const callers = allCallers.slice(0, input.maxCallers);
  const affectedModules = callers.map((caller) => caller.path);
  const tests = callers.filter((caller) => caller.testFile).map((caller) => caller.path);
  const totalCount = numberValue(searchRaw.total_count);

  return json({
    ok: true,
    repository: {
      name: input.repository,
      defaultBranch: snapshot.defaultBranch,
      searchIndexedBranch: snapshot.defaultBranch,
      requestedRef: snapshot.requestedRef,
      resolvedRefSha: snapshot.resolvedSha,
    },
    target: {
      path: input.path,
      contentSha: isObject(targetRaw) ? stringValue(targetRaw.sha) : null,
      size: isObject(targetRaw) ? numberValue(targetRaw.size) : null,
      imports: directImports,
      importsTruncated: directImports.length >= MAX_IMPORTS,
    },
    summary: {
      directImports: directImports.length,
      candidateFiles: candidates.length,
      callers: callers.length,
      affectedModules: affectedModules.length,
      affectedTests: tests.length,
    },
    callers,
    affectedModules,
    tests,
    callerSearch: {
      seed,
      totalCount,
      incompleteResults: searchRaw.incomplete_results === true,
      candidateLimit,
      callersTruncated: callers.length < allCallers.length || (totalCount !== null && totalCount > candidateLimit),
    },
    note:
      snapshot.requestedRef === snapshot.defaultBranch
        ? 'Import parsing and caller resolution are heuristic; returned caller matches include line evidence and confidence.'
        : 'GitHub code search seeds candidates from the default-branch index; candidate content and caller verification are pinned to the requested snapshot.',
  });
}

function objectResponse(description: string): JsonObject {
  return {
    description,
    content: { 'application/json': { schema: { type: 'object', properties: {} } } },
  };
}

export function addDependencyGraphOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[DEPENDENCY_GRAPH_PATH] = {
    post: {
      operationId: 'investigateDependencies',
      summary: 'Trace file imports and likely callers',
      description:
        'Pins a target file to an exact repository snapshot, extracts direct imports and returns a bounded set of caller modules whose pinned import evidence resolves to the target.',
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
                maxCallers: { type: 'integer', minimum: 1, maximum: MAX_CALLERS, default: 8 },
                maxCandidates: {
                  type: 'integer', minimum: 1, maximum: MAX_CANDIDATES,
                  description: 'Optional caller-search candidate cap for bounded composed workflows.',
                },
              },
            },
          },
        },
      },
      responses: {
        '200': objectResponse('Dependency and caller graph'),
        '400': objectResponse('Invalid dependency graph request'),
        '422': objectResponse('Target content unavailable for analysis'),
        '502': objectResponse('GitHub dependency lookup failed'),
      },
    },
  };
}

export async function handleDependencyGraphAction(
  request: Request,
  invoke: Invoke,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== DEPENDENCY_GRAPH_PATH) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    return await dependencyGraph(request, invoke);
  } catch (error) {
    if (error instanceof DependencyGraphError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        dependencyGraph: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'dependency_graph_internal_error' }, 500);
  }
}
