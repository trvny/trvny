import { runWithActionRequestContext } from './action-context.ts';
import {
  addBugInvestigationOpenApi,
  BUG_INVESTIGATION_PATH,
  handleBugInvestigationAction,
} from './bug-investigation.ts';
import {
  addCodeChangeAutopilotOpenApi,
  CODE_CHANGE_AUTOPILOT_PATH,
  handleCodeChangeAutopilotAction,
} from './code-change-orchestration.ts';
import {
  addCodeHistoryOpenApi,
  CODE_HISTORY_PATH,
  handleCodeHistoryAction,
} from './code-history.ts';
import {
  addDependencyGraphOpenApi,
  DEPENDENCY_GRAPH_PATH,
  handleDependencyGraphAction,
} from './dependency-graph.ts';
import { enrichConflictResponse } from './conflict-response.ts';
import { scheduleFreeReviewWebhook } from './free-review.ts';
import worker, {
  actionFetch,
  CommentProbeLock,
  gatewayManifest,
  gatewayOpenApi,
  OperatorCheckpointStore,
} from './entry.ts';
import {
  addReleaseEntryOpenApi,
  handleReleaseEntryAction,
  RELEASE_ENTRY_UPLOAD_PATH,
} from './release-entry-action.ts';
import {
  addReleaseReplaceOpenApi,
  handleReleaseReplaceAction,
  RELEASE_ASSET_REPLACE_PATH,
} from './release-replace-action.ts';
import {
  addSymbolInvestigationOpenApi,
  handleSymbolInvestigationAction,
  SYMBOL_INVESTIGATION_PATH,
} from './symbol-investigation.ts';
import {
  addTargetedTestsOpenApi,
  handleTargetedTestsAction,
  TARGETED_TESTS_PATH,
} from './test-discovery.ts';

export { actionFetch, CommentProbeLock, OperatorCheckpointStore };

type WorkerEnv = Parameters<typeof worker.fetch>[1];
type JsonObject = Record<string, unknown>;
type Env = WorkerEnv & {
  CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
};

const OPENAPI_PATH = '/gpt-actions/openapi.json';
const CAPABILITY_PATH = '/gpt-actions/operator/capabilities';
const SMOKE_PATH = '/gpt-actions/operator/smoke';
const HEALTH_PATH = '/health';
const WEBHOOK_PATH = '/webhooks/github';

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function openApi(request: Request): JsonObject {
  const document = gatewayOpenApi(new URL(request.url).origin);
  addReleaseEntryOpenApi(document);
  addReleaseReplaceOpenApi(document);
  addSymbolInvestigationOpenApi(document);
  addCodeHistoryOpenApi(document);
  addDependencyGraphOpenApi(document);
  addTargetedTestsOpenApi(document);
  addBugInvestigationOpenApi(document);
  addCodeChangeAutopilotOpenApi(document);
  return document;
}

async function manifest(request: Request, env: Env): Promise<JsonObject> {
  return gatewayManifest(openApi(request), env.CF_VERSION_METADATA);
}

async function responseObject(response: Response): Promise<JsonObject | null> {
  try {
    const value: unknown = await response.clone().json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function decorateGatewayResponse(
  request: Request,
  response: Response,
  env: Env,
): Promise<Response> {
  if (!response.ok) return response;
  const pathname = new URL(request.url).pathname;
  if (pathname === CAPABILITY_PATH && request.method === 'GET') {
    return json({ ok: true, ...(await manifest(request, env)) }, response.status);
  }
  if (pathname === HEALTH_PATH && request.method === 'GET') {
    const payload = await responseObject(response);
    return payload ? json({ ...payload, gateway: await manifest(request, env) }, response.status) : response;
  }
  if (pathname === SMOKE_PATH && request.method === 'POST') {
    const payload = await responseObject(response);
    const live = await manifest(request, env);
    const openApiManifest = isObject(live.openApi) ? live.openApi : {};
    return payload
      ? json({
          ...payload,
          workerVersion: live.workerVersion ?? payload.workerVersion,
          capabilityDigest: openApiManifest.capabilityDigest ?? payload.capabilityDigest,
          operationCount: openApiManifest.operationCount ?? payload.operationCount,
        }, response.status)
      : response;
  }
  return response;
}

const runtime = {
  fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    return runWithActionRequestContext(async () => {
      const url = new URL(request.url);
      const reviewRequest =
        url.pathname === WEBHOOK_PATH && request.method === 'POST'
          ? request.clone()
          : null;
      if (url.pathname === OPENAPI_PATH && request.method === 'GET') {
        return json(openApi(request));
      }
      if (url.pathname === BUG_INVESTIGATION_PATH) {
        const response = await handleBugInvestigationAction(
          request,
          (internalRequest) => worker.fetch(internalRequest, env, ctx),
        );
        if (response) return response;
      }
      if (url.pathname === CODE_CHANGE_AUTOPILOT_PATH) {
        const response = await handleCodeChangeAutopilotAction(
          request,
          env,
          (internalRequest) => worker.fetch(internalRequest, env, ctx),
        );
        if (response) return response;
      }
      if (url.pathname === RELEASE_ENTRY_UPLOAD_PATH) {
        const response = await handleReleaseEntryAction(request, env, actionFetch);
        if (response) return response;
      }
      if (url.pathname === RELEASE_ASSET_REPLACE_PATH) {
        const response = await handleReleaseReplaceAction(
          request,
          env,
          actionFetch,
          (internalRequest) => worker.fetch(internalRequest, env, ctx),
        );
        if (response) return response;
      }
      if (url.pathname === SYMBOL_INVESTIGATION_PATH) {
        const response = await handleSymbolInvestigationAction(
          request,
          (internalRequest) => worker.fetch(internalRequest, env, ctx),
        );
        if (response) return response;
      }
      if (url.pathname === CODE_HISTORY_PATH) {
        const response = await handleCodeHistoryAction(
          request,
          (internalRequest) => worker.fetch(internalRequest, env, ctx),
        );
        if (response) return response;
      }
      if (url.pathname === DEPENDENCY_GRAPH_PATH) {
        const response = await handleDependencyGraphAction(
          request,
          (internalRequest) => worker.fetch(internalRequest, env, ctx),
        );
        if (response) return response;
      }
      if (url.pathname === TARGETED_TESTS_PATH) {
        const response = await handleTargetedTestsAction(
          request,
          (internalRequest) => worker.fetch(internalRequest, env, ctx),
        );
        if (response) return response;
      }

      const baseResponse = await worker.fetch(request, env, ctx);
      if (reviewRequest && baseResponse.status === 202) {
        scheduleFreeReviewWebhook(reviewRequest, env, ctx);
      }
      const response = await decorateGatewayResponse(request, baseResponse, env);
      return enrichConflictResponse(
        request,
        response,
        (internalRequest) => worker.fetch(internalRequest, env, ctx),
      );
    });
  },
};

export default runtime;
