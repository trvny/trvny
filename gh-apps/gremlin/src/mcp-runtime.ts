import {
  actionFetch,
  scopedMcpManifest,
  gatewayManifest,
  githubGateway,
  handleScopedMcp,
  scopedRuntimeOpenApi,
  type ActionInvoke,
  type JsonObject,
  type RuntimeEnv,
  type SpecialistToolName,
} from 'kanarek-companion/runtime';

// Gremlin owns the plugin's 18 high-value operators. The legacy Custom GPT
// keeps its separately curated, broader Action surface.
export const GREMLIN_MCP_OPERATION_IDS = [
  'getOperatorBootstrap',
  'getGremlinKnowledge',
  'inspectPackage',
  'getOperatorCapabilities',
  'runOperatorSmokeTest',
  'runOperatorAutopilot',
  'getAccountMaintenance',
  'runAccountMaintenanceAutofix',
  'getRepositoryContext',
  'prepareChange',
  'implementCodeChange',
  'investigateCode',
  'reviewCodeChange',
  'inspectPullRequest',
  'finalizePullRequest',
  'orchestrateRelease',
  'diagnoseWorkflowRun',
  'githubBotRequest',
] as const;

// The shared MCP adapter enforces the chosen specialist scope and keeps
// guarded Action dispatch as the single mutation path.
export const GREMLIN_SPECIALIST_TOOL_NAMES = [
  'feedseek_search',
  'feedseek_fetch',
  'feedseek_recent',
] as const satisfies readonly SpecialistToolName[];

function gremlinOperatorOpenApi(origin: string): JsonObject {
  return scopedRuntimeOpenApi(
    origin,
    GREMLIN_MCP_OPERATION_IDS,
    'plugin_mcp_operations_missing',
  );
}

export function gremlinMcpManifest(origin: string): JsonObject {
  return scopedMcpManifest(gremlinOperatorOpenApi(origin), GREMLIN_SPECIALIST_TOOL_NAMES);
}

export async function gremlinGatewayManifest(
  origin: string,
  metadata?: RuntimeEnv['CF_VERSION_METADATA'],
): Promise<JsonObject> {
  const openApi = gremlinOperatorOpenApi(origin);
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
    gremlinOperatorOpenApi(new URL(request.url).origin),
    env,
    invoke,
    githubGateway(request, env, actionFetch),
    GREMLIN_SPECIALIST_TOOL_NAMES,
    actionFetch,
  );
}
