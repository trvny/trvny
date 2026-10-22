import { addBugInvestigationOpenApi } from './investigation/bug-investigation.ts';
import { addCodeChangeAutopilotOpenApi } from './operator/code-change-orchestration.ts';
import { addCodeHistoryOpenApi } from './investigation/code-history.ts';
import {
  CUSTOM_GPT_OPERATION_IDS,
  curateCustomGptOpenApi,
  curateOpenApiOperations,
} from './custom-gpt-surface.ts';
import { addDependencyGraphOpenApi } from './investigation/dependency-graph.ts';
import { gatewayOpenApi } from './entry.ts';
import { addFocusedCodeReviewOpenApi } from './investigation/focused-code-review.ts';
import { addReleaseEntryOpenApi } from './operator/release-entry-action.ts';
import { addReleaseReplaceOpenApi } from './operator/release-replace-action.ts';
import { addSymbolInvestigationOpenApi } from './investigation/symbol-investigation.ts';
import { addTargetedTestsOpenApi } from './investigation/test-discovery.ts';

// Gremlin plugin: high-value operator capabilities only. The legacy Custom GPT
// keeps its broader Action list; ordinary providers use their own connectors.
export const PLUGIN_MCP_OPERATION_IDS = [
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

function fullRuntimeOpenApi(origin: string): Record<string, unknown> {
  const document = gatewayOpenApi(origin);
  addReleaseEntryOpenApi(document);
  addReleaseReplaceOpenApi(document);
  addSymbolInvestigationOpenApi(document);
  addCodeHistoryOpenApi(document);
  addDependencyGraphOpenApi(document);
  addTargetedTestsOpenApi(document);
  addFocusedCodeReviewOpenApi(document);
  addBugInvestigationOpenApi(document);
  addCodeChangeAutopilotOpenApi(document);
  return document;
}

export function runtimeOpenApi(origin: string): Record<string, unknown> {
  return curateCustomGptOpenApi(fullRuntimeOpenApi(origin));
}

export function pluginMcpOpenApi(origin: string): Record<string, unknown> {
  return curateOpenApiOperations(
    fullRuntimeOpenApi(origin),
    PLUGIN_MCP_OPERATION_IDS,
    'plugin_mcp_operations_missing',
  );
}
