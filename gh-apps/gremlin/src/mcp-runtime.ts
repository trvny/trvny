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

// Gremlin owns MCP composition. The shared runtime exposes guarded services,
// not a second copy of the operator policy or specialist implementations.
export function gremlinMcpManifest(origin: string): JsonObject {
  return combinedGremlinMcpManifest(pluginMcpOpenApi(origin));
}

export async function gremlinGatewayManifest(
  origin: string,
  metadata?: RuntimeEnv['CF_VERSION_METADATA'],
): Promise<JsonObject> {
  return {
    ...await gatewayManifest(pluginMcpOpenApi(origin), metadata),
    service: 'gremlin',
    mcp: gremlinMcpManifest(origin),
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
