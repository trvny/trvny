import { runWithActionRequestContext } from './action-context.ts';
import type { ActionInvoke } from './action-auth.ts';
import { AnchorMutationReplayStore } from './specialists/anchor-replay.ts';
import { BUG_INVESTIGATION_PATH, handleBugInvestigationAction } from './investigation/bug-investigation.ts';
import {
  CODE_CHANGE_AUTOPILOT_PATH,
  handleCodeChangeAutopilotAction,
} from './operator/code-change-orchestration.ts';
import { CODE_HISTORY_PATH, handleCodeHistoryAction } from './investigation/code-history.ts';
import { DEPENDENCY_GRAPH_PATH, handleDependencyGraphAction } from './investigation/dependency-graph.ts';
import {
  FOCUSED_CODE_REVIEW_PATH,
  handleFocusedCodeReviewAction,
} from './investigation/focused-code-review.ts';
import { enrichConflictResponse } from './conflict-response.ts';
import { githubGateway, type GithubGateway } from './gptomek/github-gateway.ts';
import {
  actionFetch,
  CommentProbeLock,
  gatewayManifest,
  gatewayRoutes,
  OperatorCheckpointStore,
  ReviewProviderCooldownStore,
  type GatewayEnv,
} from './entry.ts';
import gremlinRouter from './operator/gremlin-router.ts';
import companion from './index.ts';
import { firstMatch, type Route } from './route.ts';
import { handleReleaseEntryAction, RELEASE_ENTRY_UPLOAD_PATH } from './operator/release-entry-action.ts';
import {
  handleReleaseReplaceAction,
  RELEASE_ASSET_REPLACE_PATH,
} from './operator/release-replace-action.ts';
import {
  gremlinMcpManifest as combinedGremlinMcpManifest,
  handleGremlinMcp as handleCombinedGremlinMcp,
} from './specialists/mcp-adapter.ts';
import { pluginMcpOpenApi, runtimeOpenApi } from './runtime-openapi.ts';
import { reviewProviderPoolStateViaService } from './companion/review-service.ts';
import {
  handleSymbolInvestigationAction,
  SYMBOL_INVESTIGATION_PATH,
} from './investigation/symbol-investigation.ts';
import { handleTargetedTestsAction, TARGETED_TESTS_PATH } from './investigation/test-discovery.ts';
import { type WebhookReviewEnv } from './companion/webhook-review-context.ts';
import { scheduleWebhookReviewWebhook, WebhookReviewJob } from './companion/webhook-review.ts';
import { repositoryListAllows } from './index.ts';
import { isObject, type JsonObject } from './tools/common.ts';
import { json } from './json-response.ts';
import { CAPABILITY_PATH, HEALTH_PATH, OPENAPI_PATH, SMOKE_PATH, WEBHOOK_PATH } from './paths.ts';

export {
  actionFetch,
  AnchorMutationReplayStore,
  CommentProbeLock,
  OperatorCheckpointStore,
  ReviewProviderCooldownStore,
  WebhookReviewJob,
};

export type RuntimeEnv = GatewayEnv &
  WebhookReviewEnv & {
    CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
    KANAREK_REVIEW_REPOSITORIES?: string;
  };

export function gremlinMcpManifest(origin: string): JsonObject {
  return combinedGremlinMcpManifest(pluginMcpOpenApi(origin));
}

// Reuse the shared digest/count implementation with the *curated* Gremlin
// manifest, rather than describing the full legacy Kanarek gateway.
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


async function manifest(request: Request, env: RuntimeEnv): Promise<JsonObject> {
  return gatewayManifest(
    runtimeOpenApi(new URL(request.url).origin),
    env.CF_VERSION_METADATA,
  );
}

async function responseObject(response: Response): Promise<JsonObject | null> {
  try {
    const value: unknown = await response.clone().json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

async function acceptedReviewWebhook(
  request: Request,
  response: Response,
  env: RuntimeEnv,
): Promise<boolean> {
  if (request.headers.get('x-github-event') !== 'pull_request') return false;
  const accepted = await responseObject(response);
  if (accepted?.accepted !== true) return false;

  let payload: JsonObject;
  try {
    const value: unknown = await request.clone().json();
    if (!isObject(value)) return false;
    payload = value;
  } catch {
    return false;
  }
  const repository = isObject(payload.repository) ? payload.repository : null;
  const fullName =
    typeof repository?.full_name === 'string' ? repository.full_name : '';
  if (!fullName) return false;
  return repositoryListAllows(
    env.KANAREK_REVIEW_REPOSITORIES ?? env.KANAREK_REPOSITORIES,
    fullName,
  );
}

async function reviewWebhookHealth(env: RuntimeEnv): Promise<JsonObject> {
  const enabled = !['0', 'false', 'no', 'off'].includes(
    String(env.KANAREK_WEBHOOK_REVIEW_ENABLED ?? 'true').trim().toLowerCase(),
  );
  const githubConfigured = Boolean(
    env.GITHUB_APP_ID?.trim() && env.GITHUB_PRIVATE_KEY?.trim(),
  );
  const queueConfigured = Boolean(env.KANAREK_REVIEW_JOBS);
  const routerConfigured = Boolean(env.KANAREK_REVIEW_ROUTER_TOKEN?.trim());
  const reviewState = await reviewProviderPoolStateViaService(env);
  const providerPool = reviewState.providerPool;
  return {
    enabled,
    githubConfigured,
    providerAvailable: providerPool.ready,
    providerConfigured: providerPool.configured > 0,
    providerPool,
    queueConfigured,
    serviceConfigured: reviewState.serviceConfigured,
    serviceReady: reviewState.serviceReady,
    ready:
      enabled &&
      githubConfigured &&
      queueConfigured &&
      routerConfigured &&
      providerPool.ready,
    routerConfigured,
    trigger: 'github-app-webhook',
  };
}

async function decorateGatewayResponse(
  request: Request,
  response: Response,
  env: RuntimeEnv,
): Promise<Response> {
  if (!response.ok) return response;
  const pathname = new URL(request.url).pathname;
  if (pathname === CAPABILITY_PATH && request.method === 'GET') {
    return json({ ok: true, ...(await manifest(request, env)) }, response.status);
  }
  if (pathname === HEALTH_PATH && request.method === 'GET') {
    const payload = await responseObject(response);
    return payload
      ? json(
          {
            ...payload,
            gateway: await manifest(request, env),
            reviewWebhook: await reviewWebhookHealth(env),
          },
          response.status,
        )
      : response;
  }
  if (pathname === SMOKE_PATH && request.method === 'POST') {
    const payload = await responseObject(response);
    const live = await manifest(request, env);
    const openApiManifest = isObject(live.openApi) ? live.openApi : {};
    return payload
      ? json(
          {
            ...payload,
            workerVersion: live.workerVersion ?? payload.workerVersion,
            capabilityDigest:
              openApiManifest.capabilityDigest ?? payload.capabilityDigest,
            operationCount:
              openApiManifest.operationCount ?? payload.operationCount,
          },
          response.status,
        )
      : response;
  }
  return response;
}

// Request segments, outermost first. Each segment's `below` reaches only the
// segments after it: runtime → gateway (entry.ts) → operator (gremlin-router.ts)
// → companion (index.ts, terminal 404).
type Below = (request: Request) => Promise<Response>;

interface RuntimeContext {
  request: Request;
  env: RuntimeEnv;
  ctx?: ExecutionContext;
  below: Below;
}

async function operatorOrCompanion(
  request: Request,
  env: RuntimeEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  return (await gremlinRouter.fetch(request, env)) ?? companion.fetch(request, env, ctx);
}

async function gateway(request: Request, env: RuntimeEnv, ctx?: ExecutionContext): Promise<Response> {
  const below: Below = (next) => operatorOrCompanion(next, env, ctx);
  return (await firstMatch(gatewayRoutes, { request, env, below })) ?? below(request);
}

function github(request: Request, env: RuntimeEnv): GithubGateway {
  return githubGateway(request, env, actionFetch);
}

function pathIs(request: Request, path: string): boolean {
  return new URL(request.url).pathname === path;
}

// Order matters: first match wins; unmatched requests fall through to `below`.
const runtimeRoutes: readonly Route<RuntimeContext>[] = [
  ({ request }) =>
    pathIs(request, OPENAPI_PATH) && request.method === 'GET'
      ? json(runtimeOpenApi(new URL(request.url).origin))
      : null,
  ({ request, env }) =>
    pathIs(request, FOCUSED_CODE_REVIEW_PATH)
      ? handleFocusedCodeReviewAction(request, github(request, env))
      : null,
  ({ request, env, below }) =>
    pathIs(request, BUG_INVESTIGATION_PATH)
      ? handleBugInvestigationAction(request, below, github(request, env))
      : null,
  ({ request, env, below }) =>
    pathIs(request, CODE_CHANGE_AUTOPILOT_PATH)
      ? handleCodeChangeAutopilotAction(request, env, below, github(request, env))
      : null,
  ({ request, env }) =>
    pathIs(request, RELEASE_ENTRY_UPLOAD_PATH)
      ? handleReleaseEntryAction(request, env, actionFetch)
      : null,
  ({ request, env, below }) =>
    pathIs(request, RELEASE_ASSET_REPLACE_PATH)
      ? handleReleaseReplaceAction(request, env, actionFetch, below, github(request, env))
      : null,
  ({ request, env }) =>
    pathIs(request, SYMBOL_INVESTIGATION_PATH)
      ? handleSymbolInvestigationAction(request, github(request, env))
      : null,
  ({ request, env }) =>
    pathIs(request, CODE_HISTORY_PATH)
      ? handleCodeHistoryAction(request, github(request, env))
      : null,
  ({ request, env }) =>
    pathIs(request, DEPENDENCY_GRAPH_PATH)
      ? handleDependencyGraphAction(request, github(request, env))
      : null,
  ({ request, env }) =>
    pathIs(request, TARGETED_TESTS_PATH)
      ? handleTargetedTestsAction(request, github(request, env))
      : null,
];

const runtime = {
  fetch(request: Request, env: RuntimeEnv, ctx?: ExecutionContext): Promise<Response> {
    return runWithActionRequestContext(async () => {
      const url = new URL(request.url);
      const webhookRequest =
        url.pathname === WEBHOOK_PATH && request.method === 'POST'
          ? request.clone()
          : null;
      const below: Below = (next) => gateway(next, env, ctx);

      const routed = await firstMatch(runtimeRoutes, { request, env, ctx, below });
      if (routed) return routed;

      const baseResponse = await below(request);
      if (
        webhookRequest &&
        baseResponse.status === 202 &&
        (await acceptedReviewWebhook(webhookRequest, baseResponse, env))
      ) {
        scheduleWebhookReviewWebhook(webhookRequest, env, ctx);
      }
      const response = await decorateGatewayResponse(
        request,
        baseResponse,
        env,
      );
      return enrichConflictResponse(
        request,
        response,
        github(request, env),
      );
    });
  },
};

export default runtime;