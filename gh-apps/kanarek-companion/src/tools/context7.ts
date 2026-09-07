import {
  assertSerializedSize,
  boundedJson,
  integerValue,
  isObject,
  optionalStringValue,
  SpecialistToolError,
  stringValue,
  type JsonObject,
} from './common.ts';

const CONTEXT7_API = 'https://context7.com';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REQUEST_BYTES = 32_000;
const MAX_RESPONSE_BYTES = 512_000;
const MAX_LIBRARY_ID_LENGTH = 320;

export interface Context7ToolEnv {
  CONTEXT7_API_KEY?: string;
}

interface LibraryResult {
  id: string;
  title: string;
  description: string;
  branch: string;
  totalSnippets: number;
  totalTokens?: number;
  stars?: number;
  trustScore?: number;
  benchmarkScore?: number;
  versions?: string[];
}

function upstreamHeaders(env: Context7ToolEnv): Headers {
  const headers = new Headers({
    Accept: 'application/json',
    'User-Agent': 'mechagremlin-kanarek-companion/1',
    'X-Context7-Source': 'mechagremlin',
    'X-Context7-Transport': 'http',
  });
  const key = env.CONTEXT7_API_KEY?.trim();
  if (key) headers.set('Authorization', `Bearer ${key}`);
  return headers;
}

function validLibraryId(value: string): boolean {
  return (
    value.length <= MAX_LIBRARY_ID_LENGTH &&
    value.startsWith('/') &&
    !value.includes('..') &&
    !value.includes('//') &&
    /^\/[A-Za-z0-9._@-]+(?:\/[A-Za-z0-9._@-]+)+$/.test(value)
  );
}

function upstreamError(status: number): SpecialistToolError {
  if (status === 401) return new SpecialistToolError('context7_auth_failed', 502);
  if (status === 403) return new SpecialistToolError('context7_forbidden', 502);
  if (status === 404) return new SpecialistToolError('context7_not_found', 404);
  if (status === 429) return new SpecialistToolError('context7_rate_limited', 503);
  if (status >= 500) return new SpecialistToolError('context7_unavailable', 503);
  return new SpecialistToolError(`context7_http_${status}`, 502);
}

async function context7Json(
  env: Context7ToolEnv,
  fetcher: typeof fetch,
  pathname: '/api/v2/libs/search' | '/api/v2/context',
  params: URLSearchParams,
): Promise<unknown> {
  const url = new URL(pathname, CONTEXT7_API);
  url.search = params.toString();
  try {
    const response = await fetcher(url.toString(), {
      method: 'GET',
      headers: upstreamHeaders(env),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => undefined);
      throw upstreamError(response.status);
    }
    return await boundedJson(
      response,
      MAX_RESPONSE_BYTES,
      'context7_invalid_response',
      'context7_response_too_large',
    );
  } catch (error) {
    if (error instanceof SpecialistToolError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new SpecialistToolError('context7_timeout', 504);
    }
    throw new SpecialistToolError('context7_unreachable', 503);
  }
}

function libraryResult(value: unknown): LibraryResult | null {
  if (!isObject(value) || typeof value.id !== 'string' || !validLibraryId(value.id)) return null;
  return {
    id: value.id,
    title: typeof value.title === 'string' ? value.title.slice(0, 300) : value.id,
    description: typeof value.description === 'string' ? value.description.slice(0, 1_500) : '',
    branch: typeof value.branch === 'string' ? value.branch.slice(0, 200) : '',
    totalSnippets: typeof value.totalSnippets === 'number' ? value.totalSnippets : 0,
    totalTokens: typeof value.totalTokens === 'number' ? value.totalTokens : undefined,
    stars: typeof value.stars === 'number' ? value.stars : undefined,
    trustScore: typeof value.trustScore === 'number' ? value.trustScore : undefined,
    benchmarkScore: typeof value.benchmarkScore === 'number' ? value.benchmarkScore : undefined,
    versions: Array.isArray(value.versions)
      ? value.versions.filter((entry): entry is string => typeof entry === 'string').slice(0, 20)
      : undefined,
  };
}

function compactLibrary(value: LibraryResult): JsonObject {
  return {
    id: value.id,
    title: value.title,
    description: value.description,
    branch: value.branch || null,
    totalSnippets: value.totalSnippets,
    totalTokens: value.totalTokens ?? null,
    stars: value.stars ?? null,
    trustScore: value.trustScore ?? null,
    benchmarkScore: value.benchmarkScore ?? null,
    versions: value.versions ?? [],
  };
}

async function resolveLibrary(
  libraryName: string,
  query: string,
  env: Context7ToolEnv,
  fetcher: typeof fetch,
): Promise<LibraryResult> {
  const payload = await context7Json(
    env,
    fetcher,
    '/api/v2/libs/search',
    new URLSearchParams({ libraryName, query }),
  );
  if (!isObject(payload) || !Array.isArray(payload.results)) {
    throw new SpecialistToolError('context7_invalid_library_response', 502);
  }
  const candidates = payload.results
    .map(libraryResult)
    .filter((entry): entry is LibraryResult => Boolean(entry));
  if (!candidates.length) throw new SpecialistToolError('context7_library_not_found', 404);
  return candidates[0];
}

function compactCodeSnippet(value: JsonObject): JsonObject | null {
  const title = typeof value.codeTitle === 'string' ? value.codeTitle.slice(0, 500) : 'Code example';
  const examples = Array.isArray(value.codeList)
    ? value.codeList
        .filter(isObject)
        .slice(0, 3)
        .map((entry) => ({
          language: typeof entry.language === 'string' ? entry.language.slice(0, 100) : null,
          code: typeof entry.code === 'string' ? entry.code.slice(0, 6_000) : '',
        }))
        .filter((entry) => entry.code)
    : [];
  if (!examples.length) return null;
  return {
    kind: 'code',
    title,
    description:
      typeof value.codeDescription === 'string' ? value.codeDescription.slice(0, 1_500) : null,
    language: typeof value.codeLanguage === 'string' ? value.codeLanguage.slice(0, 100) : null,
    pageTitle: typeof value.pageTitle === 'string' ? value.pageTitle.slice(0, 500) : null,
    examples,
  };
}

function compactInfoSnippet(value: JsonObject): JsonObject | null {
  if (typeof value.content !== 'string' || !value.content.trim()) return null;
  return {
    kind: 'info',
    title:
      typeof value.breadcrumb === 'string'
        ? value.breadcrumb.slice(0, 500)
        : typeof value.pageId === 'string'
          ? value.pageId.slice(0, 500)
          : 'Documentation',
    content: value.content.slice(0, 7_000),
  };
}

function compactSnippets(payload: JsonObject, limit: number): JsonObject[] {
  const snippets: JsonObject[] = [];
  if (Array.isArray(payload.codeSnippets)) {
    for (const value of payload.codeSnippets) {
      if (!isObject(value)) continue;
      const compact = compactCodeSnippet(value);
      if (compact) snippets.push(compact);
      if (snippets.length >= limit) return snippets;
    }
  }
  if (Array.isArray(payload.infoSnippets)) {
    for (const value of payload.infoSnippets) {
      if (!isObject(value)) continue;
      const compact = compactInfoSnippet(value);
      if (compact) snippets.push(compact);
      if (snippets.length >= limit) break;
    }
  }
  return snippets;
}

export async function searchContext7Docs(
  input: JsonObject,
  env: Context7ToolEnv,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  assertSerializedSize(input, MAX_REQUEST_BYTES);
  const libraryName = stringValue(input.libraryName, 'library_name', 200);
  const query = stringValue(input.query, 'query', 3_000);
  const requestedId = optionalStringValue(input.libraryId, 'library_id', MAX_LIBRARY_ID_LENGTH);
  const limit = integerValue(input.limit, 'limit', 6, 1, 10);

  if (requestedId && !validLibraryId(requestedId)) {
    throw new SpecialistToolError('invalid_library_id');
  }

  const resolved = requestedId ? null : await resolveLibrary(libraryName, query, env, fetcher);
  const libraryId = requestedId ?? resolved?.id;
  if (!libraryId) throw new SpecialistToolError('context7_library_not_found', 404);

  const payload = await context7Json(
    env,
    fetcher,
    '/api/v2/context',
    new URLSearchParams({ libraryId, query, type: 'json' }),
  );
  if (
    !isObject(payload) ||
    (!Array.isArray(payload.codeSnippets) && !Array.isArray(payload.infoSnippets))
  ) {
    throw new SpecialistToolError('context7_invalid_context_response', 502);
  }

  const fallbackLibrary: LibraryResult = {
    id: libraryId,
    title: libraryName,
    description: '',
    branch: '',
    totalSnippets: 0,
  };
  return {
    ok: true,
    resolved: !requestedId,
    authenticated: Boolean(env.CONTEXT7_API_KEY?.trim()),
    library: compactLibrary(resolved ?? fallbackLibrary),
    snippets: compactSnippets(payload, limit),
  };
}
