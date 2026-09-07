import { authorizeOperator, type ActionInvoke } from './action-auth.ts';
import { SpecialistToolError, isObject, type JsonObject } from './tools/common.ts';
import {
  SPECIALIST_TOOLS,
  invokeSpecialistTool,
  type SpecialistToolEnv,
  type SpecialistToolName,
} from './tools/registry.ts';

const ACTIONS = {
  '/gpt-actions/feedseek/search': 'feedseek_search',
  '/gpt-actions/feedseek/fetch': 'feedseek_fetch',
  '/gpt-actions/feedseek/recent': 'feedseek_recent',
} as const satisfies Record<string, SpecialistToolName>;
const MAX_REQUEST_BYTES = 32_000;

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
  try {
    const value = text.trim() ? JSON.parse(text) : {};
    if (isObject(value)) return value;
  } catch {
    // handled below
  }
  throw new SpecialistToolError('invalid_json_object');
}

function operatorSecurity(): JsonObject[] {
  return [{ githubOAuth: [] }];
}

export function addFeedseekOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  for (const [path, toolName] of Object.entries(ACTIONS)) {
    const definition = SPECIALIST_TOOLS[toolName];
    paths[path] = {
      post: {
        operationId: definition.actionOperationId,
        summary: definition.title,
        description:
          `${definition.description} Requires the authorized trvny GitHub OAuth identity. ` +
          'Feedseek remains the source of truth; this gateway calls only its fixed read-only MCP endpoint.',
        security: operatorSecurity(),
        requestBody: {
          required: true,
          content: { 'application/json': { schema: definition.inputSchema } },
        },
        responses: {
          '200': {
            description: 'Bounded Feedseek result',
            content: { 'application/json': { schema: { type: 'object', properties: {} } } },
          },
        },
      },
    };
  }
}

export async function handleFeedseekAction(
  request: Request,
  env: SpecialistToolEnv,
  invoke: ActionInvoke,
  fetcher: typeof fetch = fetch,
): Promise<Response | null> {
  const toolName = ACTIONS[new URL(request.url).pathname as keyof typeof ACTIONS];
  if (!toolName) return null;

  try {
    const authFailure = await authorizeOperator(request, invoke);
    if (authFailure) return authFailure;
    if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
    return json(await invokeSpecialistTool(toolName, await inputObject(request), env, fetcher));
  } catch (error) {
    if (error instanceof SpecialistToolError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    return json({ ok: false, error: 'feedseek_gateway_error' }, 500);
  }
}
