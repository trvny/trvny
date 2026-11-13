import { addBugInvestigationOpenApi } from './investigation/bug-investigation.ts';
import { addCodeChangeAutopilotOpenApi } from './operator/code-change-orchestration.ts';
import { addCodeHistoryOpenApi } from './investigation/code-history.ts';
import {
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

export function scopedRuntimeOpenApi(
  origin: string,
  operationIds: readonly string[],
  missingErrorPrefix = 'scoped_runtime_operations_missing',
): Record<string, unknown> {
  return curateOpenApiOperations(
    fullRuntimeOpenApi(origin),
    operationIds,
    missingErrorPrefix,
  );
}
