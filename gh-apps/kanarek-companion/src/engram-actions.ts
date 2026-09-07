import { authorizeOperator, type ActionInvoke } from './action-auth.ts';
import { SpecialistToolError, isObject, type JsonObject } from './tools/common.ts';
import { type EngramToolEnv } from './tools/engram.ts';
import { SPECIALIST_TOOLS, invokeSpecialistTool } from './tools/registry.ts';

const STATUS_PATH = '/gpt-actions/engram/status';
const SEARCH_PATH = '/gpt-actions/engram/search';
const STORE_PATH = '/gpt-actions/engram/store';
const MAX_REQUEST_BYTES = 32_000;

export interface EngramActionEnv extends EngramToolEnv {}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

async function inputObject(request: Request): Promise<JsonObject> {
  const text = await request.clone().text();
  if (text.length > MAX_REQUEST_BYTES) throw new SpecialistToolError('payload_too_large', 413);
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new SpecialistToolError('invalid_json');
  }
  if (!isObject(value)) throw new SpecialistToolError('invalid_json_object');
  return value;
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
  const status = SPECIALIST_TOOLS.engram_status;
  const search = SPECIALIST_TOOLS.engram_search;
  const store = SPECIALIST_TOOLS.engram_store;

  paths[STATUS_PATH] = {
    get: {
      operationId: status.actionOperationId,
      summary: status.title,
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
      operationId: search.actionOperationId,
      summary: search.title,
      description:
        'Requires the authorized trvny GitHub OAuth identity. Use for durable context, preferences, facts and decisions that are not already present in the current conversation.',
      security: operatorSecurity(),
      requestBody: {
        required: true,
        content: { 'application/json': { schema: search.inputSchema } },
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
      operationId: store.actionOperationId,
      summary: store.title,
      description:
        'Requires the authorized trvny GitHub OAuth identity. Store only durable preferences, facts, entities or decisions useful across sessions, not ordinary chat turns or transient task state.',
      security: operatorSecurity(),
      requestBody: {
        required: true,
        content: { 'application/json': { schema: store.inputSchema } },
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
  invoke: ActionInvoke,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (![STATUS_PATH, SEARCH_PATH, STORE_PATH].includes(pathname)) return null;

  try {
    const authFailure = await authorizeOperator(request, invoke);
    if (authFailure) return authFailure;

    if (pathname === STATUS_PATH) {
      if (request.method !== 'GET') return json({ ok: false, error: 'method_not_allowed' }, 405);
      return json(await invokeSpecialistTool('engram_status', {}, env, fetcher));
    }
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    const input = await inputObject(request);
    const result = await invokeSpecialistTool(
      pathname === SEARCH_PATH ? 'engram_search' : 'engram_store',
      input,
      env,
      fetcher,
    );
    return json(result);
  } catch (error) {
    if (error instanceof SpecialistToolError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: 'engram_gateway_error' }, 500);
  }
}
