import {
  actionFetch,
  scopedMcpManifest,
  gatewayManifest,
  githubGateway,
  handleScopedMcp,
  pluginMcpOpenApi,
  type ActionInvoke,
  type JsonObject,
  type RuntimeEnv,
  type SpecialistToolName,
} from 'kanarek-companion/runtime';

// Gremlin owns its MCP specialist selection; the shared adapter only
// enforces the selected surface and preserves guarded Action dispatch.
export const GREMLIN_SPECIALIST_TOOL_NAMES = [
  'feedseek_search',
  'feedseek_fetch',
  'feedseek_recent',
] as const satisfies readonly SpecialistToolName[];

export function gremlinMcpManifest(origin: string): JsonObject {
  return scopedMcpManifest(pluginMcpOpenApi(origin), GREMLIN_SPECIALIST_TOOL_NAMES);
}

export async function gremlinGatewayManifest(
  origin: string,
  metadata?: RuntimeEnv['CF_VERSION_METADATA'],
): Promise<JsonObject> {
  const openApi = pluginMcpOpenApi(origin);
  return {
    ...await gatewayManifest(openApi, metadata),
    service: 'gremlin',
    mcp: scopedMcpManifest(openApi, GREMLIN_SPECIALIST_TOOL_NAMES),
  };
}

export function handleGremlinMcp(
  request: Request,
  env: RuntimeEnv,
  invoke: ActionInvoke,
): Promise<Response | null> {
  return handleScopedMcp(
    request,
    pluginMcpOpenApi(new URL(request.url).origin),
    env,
    invoke,
    githubGateway(request, env, actionFetch),
    GREMLIN_SPECIALIST_TOOL_NAMES,
    actionFetch,
  );
}
