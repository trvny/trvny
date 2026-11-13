import {
  actionFetch,
  combinedGremlinMcpManifest,
  gatewayManifest,
  githubGateway,
  handleCombinedGremlinMcp,
  pluginMcpOpenApi,
  type ActionInvoke,
  type JsonObject,
  type RuntimeEnv,
} from 'kanarek-companion/runtime';

// Gremlin owns its MCP entry wiring and capability metadata.
// The shared adapter still implements operator and specialist dispatch.
export function gremlinMcpManifest(origin: string): JsonObject {
  return combinedGremlinMcpManifest(pluginMcpOpenApi(origin));
}

export async function gremlinGatewayManifest(
  origin: string,
  metadata?: RuntimeEnv['CF_VERSION_METADATA'],
): Promise<JsonObject> {
  const openApi = pluginMcpOpenApi(origin);
  return {
    ...await gatewayManifest(openApi, metadata),
    service: 'gremlin',
    mcp: combinedGremlinMcpManifest(openApi),
  };
}

export function handleGremlinMcp(
  request: Request,
  env: RuntimeEnv,
  invoke: ActionInvoke,
): Promise<Response | null> {
  return handleCombinedGremlinMcp(
    request,
    pluginMcpOpenApi(new URL(request.url).origin),
    env,
    invoke,
    githubGateway(request, env, actionFetch),
    actionFetch,
  );
}
