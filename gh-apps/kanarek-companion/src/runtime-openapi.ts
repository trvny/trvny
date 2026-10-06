import { addBugInvestigationOpenApi } from './bug-investigation.ts';
import { addCodeChangeAutopilotOpenApi } from './code-change-orchestration.ts';
import { addCodeHistoryOpenApi } from './code-history.ts';
import {
  CUSTOM_GPT_OPERATION_IDS,
  curateCustomGptOpenApi,
  curateOpenApiOperations,
} from './custom-gpt-surface.ts';
import { addDependencyGraphOpenApi } from './dependency-graph.ts';
import { gatewayOpenApi } from './entry.ts';
import { addFocusedCodeReviewOpenApi } from './focused-code-review.ts';
import { addReleaseEntryOpenApi } from './release-entry-action.ts';
import { addReleaseReplaceOpenApi } from './release-replace-action.ts';
import { addSymbolInvestigationOpenApi } from './symbol-investigation.ts';
import { addTargetedTestsOpenApi } from './test-discovery.ts';

export const PLUGIN_MCP_OPERATION_IDS = [
  ...CUSTOM_GPT_OPERATION_IDS,
  'getDocsIndex',
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
