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
export const CUSTOM_GPT_DESCRIPTION_LIMIT = 300;

// Keep the Builder-facing GitHub-authenticated surface intentionally small. Gremlin
// uses 29 operations here plus one separately authenticated Anchor OAuth operation.
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

function clippedDescription(value: string): string {
  if (value.length <= CUSTOM_GPT_DESCRIPTION_LIMIT) return value;
  const candidate = value.slice(0, CUSTOM_GPT_DESCRIPTION_LIMIT - 3).trimEnd();
  const lastSpace = candidate.lastIndexOf(' ');
  const clipped = lastSpace >= 240 ? candidate.slice(0, lastSpace).trimEnd() : candidate;
  return `${clipped}...`;
}

function declaresObjectSchema(value: JsonObject): boolean {
  if (value.type === 'object') return true;
  return Array.isArray(value.type) && value.type.includes('object');
}

function normalizeBuilderCompatibility(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) normalizeBuilderCompatibility(entry);
    return;
  }
  if (!isObject(value)) return;

  if (typeof value.description === 'string') {
    value.description = clippedDescription(value.description);
  }
  if (declaresObjectSchema(value) && !isObject(value.properties)) {
    value.properties = {};
  }

  for (const entry of Object.values(value)) normalizeBuilderCompatibility(entry);
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

  normalizeBuilderCompatibility(document);
  return document;
}
