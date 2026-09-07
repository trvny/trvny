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

const FEEDSEEK_MCP_URL = 'https://feeds.trfny.com/mcp';
const MCP_PROTOCOL_VERSION = '2026-07-28';
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_REQUEST_BYTES = 32_000;
const MAX_RESPONSE_BYTES = 768_000;

type FeedseekRemoteTool = 'search' | 'fetch' | 'recent';

function upstreamError(status: number): SpecialistToolError {
  if (status === 429) return new SpecialistToolError('feedseek_rate_limited', 503);
  if (status >= 500) return new SpecialistToolError('feedseek_unavailable', 503);
  return new SpecialistToolError(`feedseek_http_${status}`, 502);
}

async function callFeedseek(
  name: FeedseekRemoteTool,
  args: JsonObject,
  fetcher: typeof fetch,
): Promise<JsonObject> {
  try {
    const response = await fetcher(FEEDSEEK_MCP_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `gremlin-${name}`,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      if (response.body) await response.body.cancel().catch(() => undefined);
      throw upstreamError(response.status);
    }
    const payload = await boundedJson(
      response,
      MAX_RESPONSE_BYTES,
      'feedseek_invalid_response',
      'feedseek_response_too_large',
    );
    if (!isObject(payload) || payload.jsonrpc !== '2.0') {
      throw new SpecialistToolError('feedseek_invalid_response', 502);
    }
    if (isObject(payload.error)) throw new SpecialistToolError('feedseek_tool_error', 502);
    const result = isObject(payload.result) ? payload.result : null;
    if (!result || result.isError === true || !isObject(result.structuredContent)) {
      throw new SpecialistToolError('feedseek_tool_error', 502);
    }
    return { ok: true, ...result.structuredContent };
  } catch (error) {
    if (error instanceof SpecialistToolError) throw error;
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new SpecialistToolError('feedseek_timeout', 504);
    }
    throw new SpecialistToolError('feedseek_unreachable', 503);
  }
}

function optionalQuery(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > 2_000) {
    throw new SpecialistToolError('invalid_query');
  }
  return value.trim();
}

function recentSources(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) {
    throw new SpecialistToolError('invalid_sources');
  }
  return value.map((entry) => stringValue(entry, 'source', 120));
}

function recentSince(value: unknown): string | undefined {
  const since = optionalStringValue(value, 'since', 64);
  if (!since) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(since)) {
    throw new SpecialistToolError('invalid_since');
  }
  return since;
}

export async function searchFeedseek(
  input: JsonObject,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  assertSerializedSize(input, MAX_REQUEST_BYTES);
  return callFeedseek('search', { query: optionalQuery(input.query) }, fetcher);
}

export async function fetchFeedseekEntry(
  input: JsonObject,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  assertSerializedSize(input, MAX_REQUEST_BYTES);
  return callFeedseek('fetch', { id: stringValue(input.id, 'id', 2_000) }, fetcher);
}

export async function getRecentFeedseekEntries(
  input: JsonObject,
  fetcher: typeof fetch = fetch,
): Promise<JsonObject> {
  assertSerializedSize(input, MAX_REQUEST_BYTES);
  const since = recentSince(input.since);
  const args: JsonObject = {
    query: optionalQuery(input.query),
    sources: recentSources(input.sources),
    limit: integerValue(input.limit, 'limit', 50, 1, 100),
  };
  if (since) args.since = since;
  return callFeedseek('recent', args, fetcher);
}
