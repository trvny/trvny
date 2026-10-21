import { GithubActionError, githubGateway, githubReadAllowed } from '../gptomek/github-gateway.ts';
import type { GptActionsEnv } from '../gptomek/gpt-actions.ts';
import { isObject, type JsonObject, CodedError } from '../tools/common.ts';
import { json } from '../json-response.ts';

const BATCH_READ_PATH = '/gpt-actions/github/read-batch';
const MAX_BATCH_READS = 10;

class BatchReadError extends CodedError {}

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

function compactFailure(path: string, error: unknown): JsonObject {
  const failure = error instanceof GithubActionError ? error : null;
  return {
    path,
    ok: false,
    status: failure?.status ?? 502,
    error: failure?.code ?? 'action_failed',
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
  const github = githubGateway(request, env, fetcher);

  await Promise.all(
    unique.map(async (path) => {
      try {
        const data = await github.read(path);
        fetched.set(path, { path, ok: true, status: 200, data: data ?? null });
      } catch (error) {
        fetched.set(path, compactFailure(path, error));
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
        'Runs up to 10 allowlisted trvny/travnie-scoped GETs concurrently. Duplicate paths are fetched once and reused; individual GitHub failures are returned per item.',
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
