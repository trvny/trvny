import {
  assertSerializedSize,
  boundedJson,
  integerValue,
  isObject,
  SpecialistToolError,
  stringValue,
  type JsonObject,
} from './common.ts';

const ENGRAM_API = 'https://api.engrammemory.ai';
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_REQUEST_BYTES = 32_000;
const MAX_RESPONSE_BYTES = 192_000;

export const ENGRAM_CATEGORIES = ['preference', 'fact', 'decision', 'entity', 'other'] as const;
export type EngramCategory = (typeof ENGRAM_CATEGORIES)[number];

export interface EngramToolEnv {
  ENGRAM_API_KEY?: string;
}

function apiKey(env: EngramToolEnv): string {
  const key = env.ENGRAM_API_KEY?.trim();
  if (!key) throw new SpecialistToolError('engram_unconfigured', 503);
  return key;
}

function upstreamHeaders(env: EngramToolEnv): Headers {
  return new Headers({
    Authorization: `Bearer ${apiKey(env)}`,
    'Content-Type': 'application/json',
    'User-Agent': 'mechagremlin-kanarek-companion/1',
    'X-API-Version': '1',
  });
}

function upstreamError(status: number): SpecialistToolError {
  if (status === 401) return new SpecialistToolError('engram_auth_failed', 502);
  if (status === 403) return new SpecialistToolError('engram_forbidden', 502);
  if (status === 429) return new SpecialistToolError('engram_rate_limited', 503);
  if (status >= 500) return new SpecialistToolError('engram_unavailable', 503);
  return new SpecialistToolError(`engram_http_${status}`, 502);
}

async function engramRequest(
  env: EngramToolEnv,
  fetcher: typeof fetch,
  pathname: '/v1/health' | '/v1/search' | '/v1/store',
  body?: JsonObject,
): Promise<unknown> {
  try {
    const response = await fetcher(`${ENGRAM_API}${pathname}`, {
      method: body ? 'POST' : 'GET',
      headers: upstreamHeaders(env),
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      if (errorBody.length > MAX_RESPONSE_BYTES) {
        throw new SpecialistToolError('engram_response_too_large', 502);
      }
      throw upstreamError(response.status);
    }
    return await boundedJson(
      response,
      MAX_RESPONSE_BYTES,
      'engram_invalid_response',
      'engram_response_too_large',
    );
  } catch (error) {
    if (error instanceof SpecialistToolError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new SpecialistToolError('engram_timeout', 504);
    }
    throw new SpecialistToolError('engram_unreachable', 503);
  }
}

function category(value: unknown): EngramCategory {
  if (value === undefined) return 'other';
  if (typeof value !== 'string' || !ENGRAM_CATEGORIES.includes(value as EngramCategory)) {
    throw new SpecialistToolError('invalid_category');
  }
  return value as EngramCategory;
}

function importance(value: unknown): number {
  if (value === undefined) return 0.5;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new SpecialistToolError('invalid_importance');
  }
  return value;
}

function metadata(value: unknown): JsonObject {
  if (value === undefined) return {};
  if (!isObject(value)) throw new SpecialistToolError('invalid_metadata');
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new SpecialistToolError('invalid_metadata');
  }
  if (serialized.length > 8_000) throw new SpecialistToolError('metadata_too_large');
  return value;
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

export async function getEngramStatus(
  env: EngramToolEnv,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  if (!env.ENGRAM_API_KEY?.trim()) {
    return { ok: true, configured: false, reachable: null };
  }
  try {
    await engramRequest(env, fetcher, '/v1/health');
    return { ok: true, configured: true, reachable: true };
  } catch (error) {
    if (error instanceof SpecialistToolError) {
      return { ok: true, configured: true, reachable: false, error: error.code };
    }
    throw error;
  }
}

export async function searchEngramMemory(
  input: JsonObject,
  env: EngramToolEnv,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  assertSerializedSize(input, MAX_REQUEST_BYTES);
  const payload = await engramRequest(env, fetcher, '/v1/search', {
    query: stringValue(input.query, 'query', 2_000),
    top_k: integerValue(input.limit, 'limit', 6, 1, 12),
    scope: 'personal',
  });
  if (!isObject(payload) || !Array.isArray(payload.results)) {
    throw new SpecialistToolError('engram_invalid_search_response', 502);
  }
  return {
    ok: true,
    results: payload.results
      .slice(0, 12)
      .map(compactMemory)
      .filter((entry): entry is JsonObject => Boolean(entry)),
    queryTokens: typeof payload.query_tokens === 'number' ? payload.query_tokens : null,
  };
}

export async function storeEngramMemory(
  input: JsonObject,
  env: EngramToolEnv,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  assertSerializedSize(input, MAX_REQUEST_BYTES);
  const callerMetadata = metadata(input.metadata);
  const payload = await engramRequest(env, fetcher, '/v1/store', {
    text: stringValue(input.text, 'text', 8_000),
    category: category(input.category),
    importance: importance(input.importance),
    metadata: { ...callerMetadata, source: 'mechagremlin' },
    collection: 'agent-memory',
  });
  if (!isObject(payload)) throw new SpecialistToolError('engram_invalid_store_response', 502);
  return {
    ok: true,
    id: typeof payload.id === 'string' ? payload.id : null,
    status: typeof payload.status === 'string' ? payload.status : null,
    category: typeof payload.category === 'string' ? payload.category : null,
    duplicate: payload.duplicate === true,
    message: typeof payload.message === 'string' ? payload.message.slice(0, 500) : null,
  };
}
