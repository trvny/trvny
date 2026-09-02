import { runWithActionRequestContext } from './action-context.ts';
import { BUG_INVESTIGATION_PATH, handleBugInvestigationAction } from './bug-investigation.ts';
import {
  CODE_CHANGE_AUTOPILOT_PATH,
  handleCodeChangeAutopilotAction,
} from './code-change-orchestration.ts';
import { CODE_HISTORY_PATH, handleCodeHistoryAction } from './code-history.ts';
import { DEPENDENCY_GRAPH_PATH, handleDependencyGraphAction } from './dependency-graph.ts';
import { enrichConflictResponse } from './conflict-response.ts';
import worker, {
  actionFetch,
  CommentProbeLock,
  gatewayManifest,
  OperatorCheckpointStore,
  ReviewProviderCooldownStore,
} from './entry.ts';
import { handleReleaseEntryAction, RELEASE_ENTRY_UPLOAD_PATH } from './release-entry-action.ts';
import {
  handleReleaseReplaceAction,
  RELEASE_ASSET_REPLACE_PATH,
} from './release-replace-action.ts';
import { runtimeOpenApi } from './runtime-openapi.ts';
import {
  handleSymbolInvestigationAction,
  SYMBOL_INVESTIGATION_PATH,
} from './symbol-investigation.ts';
import { handleTargetedTestsAction, TARGETED_TESTS_PATH } from './test-discovery.ts';
import {
  scheduleWebhookReviewWebhook,
  WebhookReviewJob,
  type WebhookReviewEnv,
} from './webhook-review.ts';

export {
  actionFetch,
  CommentProbeLock,
  OperatorCheckpointStore,
  ReviewProviderCooldownStore,
  WebhookReviewJob,
};

type WorkerEnv = Parameters<typeof worker.fetch>[1];
type JsonObject = Record<string, unknown>;
type Env = WorkerEnv &
  WebhookReviewEnv & {
    CF_VERSION_METADATA?: { id?: string; tag?: string; timestamp?: string };
    KANAREK_REVIEW_REPOSITORIES?: string;
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

async function manifest(request: Request, env: Env): Promise<JsonObject> {
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

function configuredRepositoryAllowed(
  configured: string | undefined,
  repository: string,
): boolean {
  return String(configured ?? 'trvny/trvny')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .some((entry) => {
      if (entry === repository) return true;
      if (!entry.endsWith('/*')) return false;
      return repository.startsWith(`${entry.slice(0, -2)}/`);
    });
}

async function acceptedReviewWebhook(
  request: Request,
  response: Response,
  env: Env,
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
  return configuredRepositoryAllowed(
    env.KANAREK_REVIEW_REPOSITORIES ?? env.KANAREK_REPOSITORIES,
    fullName,
  );
}

function reviewWebhookHealth(env: Env): JsonObject {
  const enabled = !['0', 'false', 'no', 'off'].includes(
    String(env.KANAREK_WEBHOOK_REVIEW_ENABLED ?? 'true').trim().toLowerCase(),
  );
  const queueConfigured = Boolean(env.KANAREK_REVIEW_JOBS);
  const routerConfigured = Boolean(env.KANAREK_REVIEW_ROUTER_TOKEN?.trim());
  const providerConfigured = Boolean(
    env.OPENROUTER_API_KEY || env.ORCAROUTER_API_KEY || env.AIHUBMIX_API_KEY,
  );
  return {
    enabled,
    providerConfigured,
    queueConfigured,
    ready: enabled && queueConfigured && routerConfigured && providerConfigured,
    routerConfigured,
    trigger: 'github-app-webhook',
  };
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
    return payload
      ? json(
          {
            ...payload,
            gateway: await manifest(request, env),
            reviewWebhook: reviewWebhookHealth(env),
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

const runtime = {
  fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    return runWithActionRequestContext(async () => {
      const url = new URL(request.url);
      const webhookRequest =
        url.pathname === WEBHOOK_PATH && request.method === 'POST'
          ? request.clone()
          : null;

      if (url.pathname === OPENAPI_PATH && request.method === 'GET') {
        return json(runtimeOpenApi(new URL(request.url).origin));
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
        const response = await handleReleaseEntryAction(
          request,
          env,
          actionFetch,
        );
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
        (internalRequest) => worker.fetch(internalRequest, env, ctx),
      );
    });
  },
};

export default runtime;
