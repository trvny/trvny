import baseWorker, { CommentProbeLock } from './index.ts';
import { handleGptActions, openApiDocument } from './gpt-actions.ts';

export { CommentProbeLock };

type BaseEnv = Parameters<typeof baseWorker.fetch>[1];

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeObjectSchemas(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeObjectSchemas);
  if (!isObject(value)) return value;

  const output: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = normalizeObjectSchemas(entry);
  }
  if (output.type === 'object' && !isObject(output.properties)) {
    output.properties = {};
  }
  return output;
}

export function customGptOpenApi(origin: string): JsonObject {
  const document = normalizeObjectSchemas(openApiDocument(origin));
  if (!isObject(document)) throw new Error('invalid_openapi_document');

  if (!isObject(document.components)) document.components = {};
  const components = document.components as JsonObject;
  if (!isObject(components.schemas)) components.schemas = {};
  return document;
}

const worker = {
  async fetch(
    request: Request,
    env: BaseEnv,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/gpt-actions/openapi.json') {
      if (request.method !== 'GET') {
        return Response.json({ error: 'method_not_allowed' }, { status: 405 });
      }
      return Response.json(customGptOpenApi(url.origin), {
        headers: { 'cache-control': 'no-store' },
      });
    }
    if (url.pathname === '/gpt-actions' || url.pathname.startsWith('/gpt-actions/')) {
      return handleGptActions(request, env);
    }
    return baseWorker.fetch(request, env, ctx);
  },
};

export default worker;
