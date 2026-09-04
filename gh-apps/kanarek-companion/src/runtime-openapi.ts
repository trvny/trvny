import { addBugInvestigationOpenApi } from './bug-investigation.ts';
import { addCodeChangeAutopilotOpenApi } from './code-change-orchestration.ts';
import { addCodeHistoryOpenApi } from './code-history.ts';
import { addDependencyGraphOpenApi } from './dependency-graph.ts';
import { gatewayOpenApi } from './entry.ts';
import { addFocusedCodeReviewOpenApi } from './focused-code-review.ts';
import { addReleaseEntryOpenApi } from './release-entry-action.ts';
import { addReleaseReplaceOpenApi } from './release-replace-action.ts';
import { addSymbolInvestigationOpenApi } from './symbol-investigation.ts';
import { addTargetedTestsOpenApi } from './test-discovery.ts';

export function runtimeOpenApi(origin: string): Record<string, unknown> {
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
