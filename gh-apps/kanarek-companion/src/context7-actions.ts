import { authorizeOperator, type ActionInvoke } from './action-auth.ts';
import { SpecialistToolError, isObject, type JsonObject } from './tools/common.ts';
import {
  SPECIALIST_TOOLS,
  invokeSpecialistTool,
  type SpecialistToolEnv,
} from './tools/registry.ts';

const SEARCH_PATH = '/gpt-actions/context7/search';
const MAX_REQUEST_BYTES = 32_000;

export interface Context7ActionEnv extends SpecialistToolEnv {}

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

function operatorSecurity(): JsonObject[] {
  return [{ githubOAuth: [] }];
}

export function addContext7OpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  const definition = SPECIALIST_TOOLS.context7_search;
  paths[SEARCH_PATH] = {
    post: {
      operationId: definition.actionOperationId,
      summary: definition.title,
      description:
        `${definition.description} Requires the authorized trvny GitHub OAuth identity. ` +
        'The gateway exposes no arbitrary URL or raw Context7 proxy.',
      security: operatorSecurity(),
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: definition.inputSchema,
          },
        },
      },
      responses: {
        '200': {
          description: 'Bounded Context7 documentation result',
          content: {
            'application/json': {
              schema: { type: 'object', properties: {} },
            },
          },
        },
      },
    },
  };
}

export async function handleContext7Action(
  request: Request,
  env: Context7ActionEnv,
  invoke: ActionInvoke,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== SEARCH_PATH) return null;

  try {
    const authFailure = await authorizeOperator(request, invoke);
    if (authFailure) return authFailure;
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    const result = await invokeSpecialistTool(
      'context7_search',
      await inputObject(request),
      env,
      fetcher,
    );
    return json(result);
  } catch (error) {
    if (error instanceof SpecialistToolError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: 'context7_gateway_error' }, 500);
  }
}
