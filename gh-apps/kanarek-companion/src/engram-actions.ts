const ENGRAM_API = 'https://api.engrammemory.ai';
const STATUS_PATH = '/gpt-actions/engram/status';
const SEARCH_PATH = '/gpt-actions/engram/search';
const STORE_PATH = '/gpt-actions/engram/store';
const AUTH_PATH = '/gpt-actions/github/read';
const EXPECTED_OPERATOR = 'trvny';
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_REQUEST_BYTES = 32_000;
const MAX_RESPONSE_BYTES = 192_000;
const CATEGORIES = ['preference', 'fact', 'decision', 'entity', 'other'] as const;

type Category = (typeof CATEGORIES)[number];
type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;

export interface EngramActionEnv {
  ENGRAM_API_KEY?: string;
}

class EngramActionError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'EngramActionError';
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

function internalAuthRequest(source: Request): Request {
  const url = new URL(source.url);
  url.pathname = AUTH_PATH;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path: '/user' }),
  });
}

async function authorizeOperator(request: Request, invoke: Invoke): Promise<Response | null> {
  const response = await invoke(internalAuthRequest(request));
  if (!response.ok) return response;
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return json({ ok: false, error: 'invalid_operator_identity' }, 502);
  }
  const data = isObject(payload) && isObject(payload.data) ? payload.data : null;
  if (!isObject(payload) || payload.ok !== true || data?.login !== EXPECTED_OPERATOR) {
    return json({ ok: false, error: 'operator_not_allowed' }, 403);
  }
  return null;
}

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > MAX_REQUEST_BYTES) throw new EngramActionError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new EngramActionError('invalid_json');
  }
  if (!isObject(value)) throw new EngramActionError('invalid_json_object');
  return value;
}

function stringValue(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new EngramActionError(`invalid_${name}`);
  }
  return value.trim();
}

function searchLimit(value: unknown): number {
  if (value === undefined) return 6;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 12) {
    throw new EngramActionError('invalid_limit');
  }
  return value;
}

function category(value: unknown): Category {
  if (value === undefined) return 'other';
  if (typeof value !== 'string' || !CATEGORIES.includes(value as Category)) {
    throw new EngramActionError('invalid_category');
  }
  return value as Category;
}

function importance(value: unknown): number {
  if (value === undefined) return 0.5;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new EngramActionError('invalid_importance');
  }
  return value;
}

function metadata(value: unknown): JsonObject {
  if (value === undefined) return {};
  if (!isObject(value)) throw new EngramActionError('invalid_metadata');
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new EngramActionError('invalid_metadata');
  }
  if (serialized.length > 8_000) throw new EngramActionError('metadata_too_large');
  return value;
}

function apiKey(env: EngramActionEnv): string {
  const key = env.ENGRAM_API_KEY?.trim();
  if (!key) throw new EngramActionError('engram_unconfigured', 503);
  return key;
}

function upstreamHeaders(env: EngramActionEnv): Headers {
  return new Headers({
    Authorization: `Bearer ${apiKey(env)}`,
    'Content-Type': 'application/json',
    'User-Agent': 'mechagremlin-kanarek-companion/1',
    'X-API-Version': '1',
  });
}

async function boundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new EngramActionError('engram_response_too_large', 502);
  }
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new EngramActionError('engram_invalid_response', 502);
  }
}

function compactMemory(value: unknown): JsonObject | null {
  if (!isObject(value)) return null;
  const content = typeof value.content === 'string' ? value.content.slice(0, 6_000) : null;
  if (!content) return null;
  const rawMetadata = isObject(value.metadata) ? value.metadata : null;
  let safeMetadata: JsonObject | null = rawMetadata;
  if (rawMetadata && JSON.stringify(rawMetadata).length > 4_000) safeMetadata = null;
  return {
    id: typeof value.id === 'string' ? value.id : null,
    content,
    category: typeof value.category === 'string' ? value.category : null,
    score: typeof value.score === 'number' ? value.score : null,
    confidence: typeof value.confidence === 'number' ? value.confidence : null,
    matchContext: typeof value.match_context === 'string' ? value.match_context.slice(0, 2_000) : null,
    tier: typeof value.tier === 'string' ? value.tier : null,
    importance: typeof value.importance === 'number' ? value.importance : null,
    timestamp: typeof value.timestamp === 'string' ? value.timestamp : null,
    metadata: safeMetadata,
  };
}

function upstreamError(status: number): EngramActionError {
  if (status === 401) return new EngramActionError('engram_auth_failed', 502);
  if (status === 403) return new EngramActionError('engram_forbidden', 502);
  if (status === 429) return new EngramActionError('engram_rate_limited', 503);
  if (status >= 500) return new EngramActionError('engram_unavailable', 503);
  return new EngramActionError(`engram_http_${status}`, 502);
}

async function engramRequest(
  env: EngramActionEnv,
  fetcher: typeof fetch,
  pathname: '/health' | '/v1/search' | '/v1/store',
  body?: JsonObject,
): Promise<unknown> {
  try {
    const response = await fetcher(`${ENGRAM_API}${pathname}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? upstreamHeaders(env) : { 'User-Agent': 'mechagremlin-kanarek-companion/1' },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      if (errorBody.length > MAX_RESPONSE_BYTES) {
        throw new EngramActionError('engram_response_too_large', 502);
      }
      throw upstreamError(response.status);
    }
    return await boundedJson(response);
  } catch (error) {
    if (error instanceof EngramActionError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new EngramActionError('engram_timeout', 504);
    }
    throw new EngramActionError('engram_unreachable', 503);
  }
}

async function statusAction(env: EngramActionEnv, fetcher: typeof fetch): Promise<Response> {
  if (!env.ENGRAM_API_KEY?.trim()) {
    return json({ ok: true, configured: false, reachable: null });
  }
  try {
    await engramRequest(env, fetcher, '/health');
    return json({ ok: true, configured: true, reachable: true });
  } catch (error) {
    if (error instanceof EngramActionError) {
      return json({ ok: true, configured: true, reachable: false, error: error.code });
    }
    throw error;
  }
}

async function searchAction(
  request: Request,
  env: EngramActionEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const payload = await engramRequest(env, fetcher, '/v1/search', {
    query: stringValue(input.query, 'query', 2_000),
    top_k: searchLimit(input.limit),
    scope: 'personal',
  });
  if (!isObject(payload) || !Array.isArray(payload.results)) {
    throw new EngramActionError('engram_invalid_search_response', 502);
  }
  return json({
    ok: true,
    results: payload.results
      .slice(0, 12)
      .map(compactMemory)
      .filter((entry): entry is JsonObject => Boolean(entry)),
    queryTokens: typeof payload.query_tokens === 'number' ? payload.query_tokens : null,
  });
}

async function storeAction(
  request: Request,
  env: EngramActionEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const input = await inputObject(request);
  const callerMetadata = metadata(input.metadata);
  const payload = await engramRequest(env, fetcher, '/v1/store', {
    text: stringValue(input.text, 'text', 8_000),
    category: category(input.category),
    importance: importance(input.importance),
    metadata: { ...callerMetadata, source: 'mechagremlin' },
    collection: 'agent-memory',
  });
  if (!isObject(payload)) throw new EngramActionError('engram_invalid_store_response', 502);
  return json({
    ok: true,
    id: typeof payload.id === 'string' ? payload.id : null,
    status: typeof payload.status === 'string' ? payload.status : null,
    category: typeof payload.category === 'string' ? payload.category : null,
    duplicate: payload.duplicate === true,
    message: typeof payload.message === 'string' ? payload.message.slice(0, 500) : null,
  });
}

function objectResponse(properties: JsonObject): JsonObject {
  return {
    '200': {
      description: 'Successful Engram gateway response',
      content: {
        'application/json': {
          schema: { type: 'object', properties },
        },
      },
    },
  };
}

function operatorSecurity(): JsonObject[] {
  return [{ githubOAuth: [] }];
}

export function addEngramOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;

  paths[STATUS_PATH] = {
    get: {
      operationId: 'getEngramStatus',
      summary: 'Check private Engram memory availability',
      description:
        'Requires the authorized trvny GitHub OAuth identity. Reports only configuration and reachability; never returns the Engram credential.',
      security: operatorSecurity(),
      responses: objectResponse({
        ok: { type: 'boolean' },
        configured: { type: 'boolean' },
        reachable: { type: ['boolean', 'null'] },
        error: { type: 'string' },
      }),
    },
  };

  paths[SEARCH_PATH] = {
    post: {
      operationId: 'searchEngramMemory',
      summary: 'Search private personal Engram memory',
      description:
        'Requires the authorized trvny GitHub OAuth identity. Use for durable context, preferences, facts and decisions that are not already present in the current conversation.',
      security: operatorSecurity(),
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['query'],
              properties: {
                query: { type: 'string', minLength: 1, maxLength: 2_000 },
                limit: { type: 'integer', minimum: 1, maximum: 12, default: 6 },
              },
            },
          },
        },
      },
      responses: objectResponse({
        ok: { type: 'boolean' },
        results: { type: 'array', items: { type: 'object', properties: {} } },
        queryTokens: { type: ['integer', 'null'] },
      }),
    },
  };

  paths[STORE_PATH] = {
    post: {
      operationId: 'storeEngramMemory',
      summary: 'Store private durable memory in Engram',
      description:
        'Requires the authorized trvny GitHub OAuth identity. Store only durable preferences, facts, entities or decisions useful across sessions, not ordinary chat turns or transient task state.',
      security: operatorSecurity(),
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['text'],
              properties: {
                text: { type: 'string', minLength: 1, maxLength: 8_000 },
                category: { type: 'string', enum: [...CATEGORIES], default: 'other' },
                importance: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
                metadata: { type: 'object', properties: {} },
              },
            },
          },
        },
      },
      responses: objectResponse({
        ok: { type: 'boolean' },
        id: { type: ['string', 'null'] },
        status: { type: ['string', 'null'] },
        category: { type: ['string', 'null'] },
        duplicate: { type: 'boolean' },
        message: { type: ['string', 'null'] },
      }),
    },
  };
}

export async function handleEngramAction(
  request: Request,
  env: EngramActionEnv,
  invoke: Invoke,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (![STATUS_PATH, SEARCH_PATH, STORE_PATH].includes(pathname)) return null;

  try {
    const authFailure = await authorizeOperator(request, invoke);
    if (authFailure) return authFailure;

    if (pathname === STATUS_PATH) {
      if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return await statusAction(env, fetcher);
    }
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    return pathname === SEARCH_PATH
      ? await searchAction(request, env, fetcher)
      : await storeAction(request, env, fetcher);
  } catch (error) {
    if (error instanceof EngramActionError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: 'engram_gateway_error' }, 500);
  }
}
