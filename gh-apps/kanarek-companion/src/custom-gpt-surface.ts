type JsonObject = Record<string, unknown>;

const HTTP_METHODS = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'trace',
]);

export const CUSTOM_GPT_OPERATION_LIMIT = 30;

// Keep the Builder-facing action surface intentionally small. The Worker may expose
// additional guarded routes for internal composition and other clients; Custom GPTs
// only need the high-level operator path plus a few generic escape hatches.
export const CUSTOM_GPT_OPERATION_IDS = [
  'getOperatorBootstrap',
  'getGremlinKnowledge',
  'searchDocs',
  'searchContext7Docs',
  'searchFeedseek',
  'getRecentFeedseekEntries',
  'fetchFeedseekEntry',
  'inspectPackage',
  'searchEngramMemory',
  'getCloudflareOverview',
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
  'getDocsIndex',
  'getDoc',
  'storeEngramMemory',
  'githubRead',
  'githubBotRequest',
  'createPullRequestAsTrvny',
] as const;

const CUSTOM_GPT_OPERATION_SET = new Set<string>(CUSTOM_GPT_OPERATION_IDS);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function operationIds(document: JsonObject): Set<string> {
  const ids = new Set<string>();
  if (!isObject(document.paths)) return ids;
  for (const pathItem of Object.values(document.paths)) {
    if (!isObject(pathItem)) continue;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !isObject(operation)) continue;
      if (typeof operation.operationId === 'string') ids.add(operation.operationId);
    }
  }
  return ids;
}

export function curateCustomGptOpenApi(document: JsonObject): JsonObject {
  if (CUSTOM_GPT_OPERATION_IDS.length > CUSTOM_GPT_OPERATION_LIMIT) {
    throw new Error('custom_gpt_operation_limit_exceeded');
  }
  if (!isObject(document.paths)) throw new Error('invalid_openapi_paths');

  const available = operationIds(document);
  const missing = CUSTOM_GPT_OPERATION_IDS.filter((id) => !available.has(id));
  if (missing.length) {
    throw new Error(`custom_gpt_operations_missing:${missing.join(',')}`);
  }

  const paths = document.paths as JsonObject;
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isObject(pathItem)) continue;
    let exposedOperations = 0;
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !isObject(operation)) continue;
      if (
        typeof operation.operationId === 'string' &&
        CUSTOM_GPT_OPERATION_SET.has(operation.operationId)
      ) {
        exposedOperations += 1;
        continue;
      }
      delete pathItem[method];
    }
    if (exposedOperations === 0) delete paths[path];
  }
  return document;
}
