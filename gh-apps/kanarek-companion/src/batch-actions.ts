import {
  githubReadAllowed,
  handleGptActions,
  type GptActionsEnv,
} from './gpt-actions.ts';

const READ_PATH = '/gpt-actions/github/read';
const BATCH_READ_PATH = '/gpt-actions/github/read-batch';
const MAX_BATCH_READS = 10;

type JsonObject = Record<string, unknown>;

class BatchReadError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'BatchReadError';
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
    headers: { 'cache-control': 'no-store' },
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

async function readInput(request: Request): Promise<string[]> {
  const text = await request.clone().text();
  if (text.length > 32_000) throw new BatchReadError('payload_too_large', 413);

  let input: unknown;
  try {
    input = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new BatchReadError('invalid_json');
  }
  if (!isObject(input) || !Array.isArray(input.paths)) {
    throw new BatchReadError('invalid_paths');
  }
  if (input.paths.length < 1 || input.paths.length > MAX_BATCH_READS) {
    throw new BatchReadError('invalid_paths');
  }

  const paths = input.paths.map((value) => {
    if (typeof value !== 'string' || !value || value.length > 2_000) {
      throw new BatchReadError('invalid_path');
    }
    if (!githubReadAllowed(value)) throw new BatchReadError('github_read_path_not_allowed', 403);
    return value;
  });
  return paths;
}

async function compactResult(path: string, response: Response): Promise<JsonObject> {
  let payload: unknown = null;
  try {
    payload = await response.clone().json();
  } catch {
    return {
      path,
      ok: false,
      status: 502,
      error: 'invalid_action_response',
    };
  }

  if (response.ok && isObject(payload) && payload.ok === true) {
    return {
      path,
      ok: true,
      status: response.status,
      data: payload.data ?? null,
    };
  }
  return {
    path,
    ok: false,
    status: response.status,
    error: isObject(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'action_failed',
  };
}

function compactException(path: string, error: unknown): JsonObject {
  const message = error instanceof Error ? error.message : 'action_failed';
  const match = message.match(/^github_(\d{3})(?:_|$)/);
  const status = match ? Number(match[1]) : 502;
  return {
    path,
    ok: false,
    status,
    error: message.slice(0, 500),
  };
}

async function batchRead(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response> {
  const paths = await readInput(request);
  const unique = [...new Set(paths)];
  const fetched = new Map<string, JsonObject>();

  await Promise.all(
    unique.map(async (path) => {
      try {
        const response = await handleGptActions(internalReadRequest(request, path), env, fetcher);
        fetched.set(path, await compactResult(path, response));
      } catch (error) {
        fetched.set(path, compactException(path, error));
      }
    }),
  );

  return json({
    ok: true,
    count: paths.length,
    uniqueCount: unique.length,
    results: paths.map((path) => fetched.get(path)),
  });
}

function objectResponse(description: string): JsonObject {
  return {
    '200': {
      description,
      content: {
        'application/json': {
          schema: { type: 'object', properties: {} },
        },
      },
    },
  };
}

export function addBatchOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[BATCH_READ_PATH] = {
    post: {
      operationId: 'githubReadBatch',
      summary: 'Read several GitHub REST paths in one action',
      description:
        'Runs up to 10 allowlisted trvny-scoped GETs concurrently. Duplicate paths are fetched once and reused; individual GitHub failures are returned per item.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['paths'],
              properties: {
                paths: {
                  type: 'array',
                  minItems: 1,
                  maxItems: MAX_BATCH_READS,
                  items: { type: 'string' },
                },
              },
            },
          },
        },
      },
      responses: objectResponse('Batched GitHub read results'),
    },
  };
}

export async function handleBatchAction(
  request: Request,
  env: GptActionsEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== BATCH_READ_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  try {
    return await batchRead(request, env, fetcher);
  } catch (error) {
    if (error instanceof BatchReadError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        gptBatchRead: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'batch_read_internal_error' }, 500);
  }
}
