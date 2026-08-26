import {
  associatedPullRequestNumbers,
  refreshCompanion,
  type CompanionEnv,
  type CompanionResult,
  type CompanionTarget,
} from './companion.ts';
import {
  checkInstallationAccess,
  GitHubApiError,
  type InstallationAccessCheck,
} from './github-app.ts';
import {
  handleGptomekIssueControl,
  isGptomekControlIssueEdit,
} from './gptomek-issue.ts';
import { runFreeReviewWebhook } from './free-review.ts';
import { hasAiProvider } from './quip.ts';

interface Env extends CompanionEnv {
  COMPANION_LOCK: DurableObjectNamespace;
  GITHUB_WEBHOOK_SECRET: string;
}

interface WebhookMetadata {
  action: string | null;
  delivery: string | null;
  event: string | null;
  installationId: number | null;
  repository: string | null;
}

interface CompanionLockResponse {
  duplicate?: boolean;
  failure?: Record<string, unknown>;
  ok: boolean;
  queued?: boolean;
  result?: CompanionResult;
}

const MAX_BODY_BYTES = 1_048_576;
const WEBHOOK_PATH = '/webhooks/github';
const HEALTH_PATH = '/health';
const COMMENT_WINDOW_MS = 10 * 60 * 1_000;
const PENDING_TARGET_KEY = 'pending-target';
const PENDING_DELIVERIES_KEY = 'pending-deliveries';
const PROCESSED_DELIVERIES_KEY = 'processed-deliveries';
const SUPPORTED_EVENTS = new Set([
  'check_run',
  'check_suite',
  'installation',
  'installation_repositories',
  'issues',
  'ping',
  'pull_request',
  'pull_request_review',
  'status',
  'workflow_run',
]);
const INSTALLATION_AUTH_ACTIONS = new Set([
  'created',
  'new_permissions_accepted',
  'unsuspend',
]);
const PULL_REQUEST_ACTIONS = new Set([
  'opened',
  'reopened',
  'synchronize',
  'ready_for_review',
  'converted_to_draft',
  'auto_merge_enabled',
  'auto_merge_disabled',
  'labeled',
  'unlabeled',
  'closed',
]);
const PULL_REQUEST_REVIEW_ACTIONS = new Set(['submitted', 'dismissed']);
const CHECK_RUN_ACTIONS = new Set(['completed']);
const CHECK_SUITE_ACTIONS = new Set(['completed']);
const WORKFLOW_RUN_ACTIONS = new Set(['completed']);

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function hexToBytes(value: string): ArrayBuffer | null {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes.buffer;
}

async function verifyWebhookSignature(
  secret: string,
  signatureHeader: string | null,
  payload: ArrayBuffer,
): Promise<boolean> {
  if (!secret || !signatureHeader?.startsWith('sha256=')) return false;
  const signature = hexToBytes(signatureHeader.slice('sha256='.length));
  if (!signature) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify('HMAC', key, signature, payload);
}

async function readLimitedBody(
  request: Request,
  limit = MAX_BODY_BYTES,
): Promise<ArrayBuffer | null> {
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value.byteLength) continue;

      total += value.byteLength;
      if (total > limit) {
        await reader.cancel('payload_too_large');
        return null;
      }

      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

function webhookMetadata(
  request: Request,
  payload: Record<string, unknown>,
): WebhookMetadata {
  const repository = payload.repository as
    | { full_name?: unknown }
    | undefined;
  const installation = payload.installation as { id?: unknown } | undefined;
  return {
    delivery: request.headers.get('x-github-delivery'),
    event: request.headers.get('x-github-event'),
    action: typeof payload.action === 'string' ? payload.action : null,
    repository:
      typeof repository?.full_name === 'string' ? repository.full_name : null,
    installationId:
      typeof installation?.id === 'number' ? installation.id : null,
  };
}

function repositoryAllowed(env: Env, repository: string | null): boolean {
  if (!repository) return false;
  const configured = String(env.KANAREK_REPOSITORIES ?? 'trvny/trvny')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.includes(repository);
}

function shouldCheckInstallation(metadata: WebhookMetadata): boolean {
  if (metadata.event === 'installation_repositories') return true;
  return (
    metadata.event === 'installation' &&
    metadata.action !== null &&
    INSTALLATION_AUTH_ACTIONS.has(metadata.action)
  );
}

function operationFailure(error: unknown): Record<string, unknown> {
  if (error instanceof GitHubApiError) {
    return { operation: error.operation, status: error.status };
  }
  if (error instanceof Error) return { reason: error.message };
  return { reason: 'unknown_error' };
}

async function authenticateInstallation(
  metadata: WebhookMetadata,
  env: Env,
): Promise<InstallationAccessCheck | null> {
  if (!shouldCheckInstallation(metadata)) return null;
  if (metadata.installationId === null) throw new Error('missing_installation_id');
  return checkInstallationAccess(
    env.GITHUB_APP_ID,
    env.GITHUB_PRIVATE_KEY,
    metadata.installationId,
  );
}

function validNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function pullNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const numbers = value
    .map((item) =>
      item && typeof item === 'object'
        ? validNumber((item as { number?: unknown }).number)
        : null,
    )
    .filter((item): item is number => item !== null);
  return [...new Set(numbers)];
}

function noGoblinLabel(payload: Record<string, unknown>): boolean {
  const label = payload.label as { name?: unknown } | undefined;
  return (
    typeof label?.name === 'string' &&
    label.name.trim().toLowerCase() === 'no-goblin'
  );
}

function gptomekControlEdit(
  metadata: WebhookMetadata,
  payload: Record<string, unknown>,
): boolean {
  const pr = payload.pull_request as
    | { body?: unknown; user?: { login?: unknown } }
    | undefined;
  return (
    metadata.action === 'edited' &&
    metadata.repository === 'trvny/trvny' &&
    validNumber(payload.number) === 176 &&
    pr?.user?.login === 'trvny' &&
    typeof pr.body === 'string' &&
    pr.body.includes('<!-- gptomek-command:')
  );
}

function isCompanionEvent(
  metadata: WebhookMetadata,
  payload: Record<string, unknown> = {},
): boolean {
  if (!metadata.event) return false;
  if (metadata.event === 'status') return true;
  if (!metadata.action) return false;
  if (metadata.event === 'issues') {
    return isGptomekControlIssueEdit(metadata, payload);
  }
  if (metadata.event === 'pull_request') {
    if (metadata.action === 'edited') {
      return gptomekControlEdit(metadata, payload);
    }
    if (['labeled', 'unlabeled'].includes(metadata.action)) {
      return noGoblinLabel(payload);
    }
    return PULL_REQUEST_ACTIONS.has(metadata.action);
  }
  if (metadata.event === 'pull_request_review') {
    return PULL_REQUEST_REVIEW_ACTIONS.has(metadata.action);
  }
  if (metadata.event === 'check_run') {
    return CHECK_RUN_ACTIONS.has(metadata.action);
  }
  if (metadata.event === 'check_suite') {
    return CHECK_SUITE_ACTIONS.has(metadata.action);
  }
  if (metadata.event === 'workflow_run') {
    return WORKFLOW_RUN_ACTIONS.has(metadata.action);
  }
  return false;
}

async function companionTargets(
  metadata: WebhookMetadata,
  payload: Record<string, unknown>,
  env: Env,
): Promise<CompanionTarget[]> {
  if (
    !isCompanionEvent(metadata, payload) ||
    !metadata.delivery ||
    !metadata.event ||
    !metadata.repository ||
    !repositoryAllowed(env, metadata.repository) ||
    metadata.installationId === null
  ) {
    return [];
  }

  let numbers: number[] = [];
  let sha: string | null = null;

  if (metadata.event === 'issues') {
    const issue = payload.issue as { number?: unknown } | undefined;
    const direct = validNumber(issue?.number);
    numbers = direct ? [direct] : [];
  } else if (metadata.event === 'pull_request') {
    const direct = validNumber(payload.number);
    numbers = direct ? [direct] : [];
  } else if (metadata.event === 'pull_request_review') {
    const pr = payload.pull_request as { number?: unknown } | undefined;
    const direct = validNumber(pr?.number);
    numbers = direct ? [direct] : [];
  } else if (metadata.event === 'workflow_run') {
    const run = payload.workflow_run as
      | { head_sha?: unknown; pull_requests?: unknown }
      | undefined;
    numbers = pullNumbers(run?.pull_requests);
    sha = typeof run?.head_sha === 'string' ? run.head_sha : null;
  } else if (metadata.event === 'check_suite') {
    const suite = payload.check_suite as
      | { head_sha?: unknown; pull_requests?: unknown }
      | undefined;
    numbers = pullNumbers(suite?.pull_requests);
    sha = typeof suite?.head_sha === 'string' ? suite.head_sha : null;
  } else if (metadata.event === 'check_run') {
    const run = payload.check_run as
      | { head_sha?: unknown; pull_requests?: unknown }
      | undefined;
    numbers = pullNumbers(run?.pull_requests);
    sha = typeof run?.head_sha === 'string' ? run.head_sha : null;
  } else if (metadata.event === 'status') {
    sha = typeof payload.sha === 'string' ? payload.sha : null;
  }

  if (!numbers.length && sha) {
    numbers = await associatedPullRequestNumbers(
      env,
      metadata.installationId,
      metadata.repository,
      sha,
    );
  }

  return numbers.map((pullRequestNumber) => ({
    delivery: metadata.delivery ?? '',
    installationId: metadata.installationId ?? 0,
    pullRequestNumber,
    repository: metadata.repository ?? '',
    sourceEvent: metadata.event ?? '',
  }));
}

function isCompanionTarget(value: unknown): value is CompanionTarget {
  const target = value as Partial<CompanionTarget> | null;
  return Boolean(
    target &&
      typeof target.delivery === 'string' &&
      target.delivery.length > 0 &&
      typeof target.installationId === 'number' &&
      Number.isInteger(target.installationId) &&
      target.installationId > 0 &&
      typeof target.pullRequestNumber === 'number' &&
      Number.isInteger(target.pullRequestNumber) &&
      target.pullRequestNumber > 0 &&
      typeof target.repository === 'string' &&
      /^[^/]+\/[^/]+$/.test(target.repository) &&
      typeof target.sourceEvent === 'string' &&
      target.sourceEvent.length > 0,
  );
}

function shouldCoalesceTarget(target: CompanionTarget): boolean {
  if (target.sourceEvent === 'issues') return false;
  return !(
    target.repository === 'trvny/trvny' && target.pullRequestNumber === 176
  );
}

async function runTarget(target: CompanionTarget, env: Env): Promise<void> {
  const id = env.COMPANION_LOCK.idFromName(
    `${target.repository}#${target.pullRequestNumber}`,
  );
  const response = await env.COMPANION_LOCK.get(id).fetch(
    'https://kanarek-companion.internal/refresh',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(target),
    },
  );
  const payload = (await response.json()) as CompanionLockResponse;
  if (!response.ok || !payload.ok) {
    console.error(
      JSON.stringify({
        companion: 'failed',
        delivery: target.delivery,
        failure: payload.failure ?? {
          reason: `companion_lock_failed_${response.status}`,
        },
        pullRequestNumber: target.pullRequestNumber,
        repository: target.repository,
        sourceEvent: target.sourceEvent,
      }),
    );
    return;
  }

  console.log(
    JSON.stringify({
      companion: {
        changed: payload.result?.changed ?? false,
        commentId: payload.result?.commentId ?? null,
        duplicate: payload.duplicate ?? false,
        queued: payload.queued ?? false,
        quipSource: payload.result?.quipSource ?? null,
        state: payload.result?.state ?? null,
      },
      delivery: target.delivery,
      pullRequestNumber: target.pullRequestNumber,
      repository: target.repository,
      sourceEvent: target.sourceEvent,
    }),
  );
}

async function runCompanionEvent(
  metadata: WebhookMetadata,
  payload: Record<string, unknown>,
  env: Env,
): Promise<void> {
  try {
    const targets = await companionTargets(metadata, payload, env);
    await Promise.all(targets.map((target) => runTarget(target, env)));
    if (!targets.length) {
      console.log(
        JSON.stringify({
          companion: 'no_pull_requests',
          delivery: metadata.delivery,
          event: metadata.event,
          repository: metadata.repository,
        }),
      );
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        companion: 'failed',
        delivery: metadata.delivery,
        event: metadata.event,
        failure: operationFailure(error),
        repository: metadata.repository,
      }),
    );
  }
}

function scheduleCompanion(
  metadata: WebhookMetadata,
  payload: Record<string, unknown>,
  env: Env,
  ctx?: ExecutionContext,
): boolean {
  if (!isCompanionEvent(metadata, payload) || !repositoryAllowed(env, metadata.repository)) {
    return false;
  }
  const task = runCompanionEvent(metadata, payload, env);
  if (ctx) ctx.waitUntil(task);
  else void task;
  return true;
}

async function handleWebhook(
  request: Request,
  env: Env,
  ctx?: ExecutionContext,
): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, 413);
  }

  const body = await readLimitedBody(request);
  if (!body) return json({ error: 'payload_too_large' }, 413);

  const valid = await verifyWebhookSignature(
    env.GITHUB_WEBHOOK_SECRET,
    request.headers.get('x-hub-signature-256'),
    body,
  );
  if (!valid) return json({ error: 'invalid_signature' }, 401);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(body)) as Record<
      string,
      unknown
    >;
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const metadata = webhookMetadata(request, payload);
  const supported =
    metadata.event !== null && SUPPORTED_EVENTS.has(metadata.event);
  let authentication: InstallationAccessCheck | null = null;

  try {
    authentication = await authenticateInstallation(metadata, env);
  } catch (error) {
    const failure = operationFailure(error);
    console.error(
      JSON.stringify({
        ...metadata,
        supported,
        authentication: 'failed',
        failure,
      }),
    );
    return json(
      {
        accepted: true,
        supported,
        delivery: metadata.delivery,
        event: metadata.event,
        authentication: {
          ok: false,
          error: 'installation_auth_failed',
          failure,
        },
      },
      202,
    );
  }

  const companionScheduled = scheduleCompanion(metadata, payload, env, ctx);
  console.log(
    JSON.stringify({
      ...metadata,
      supported,
      authentication: authentication
        ? {
            ok: true,
            repositoryCount: authentication.repositoryCount,
            expiresAt: authentication.expiresAt,
          }
        : null,
      companion: companionScheduled ? { scheduled: true } : null,
    }),
  );

  return json(
    {
      accepted: true,
      supported,
      delivery: metadata.delivery,
      event: metadata.event,
      authentication: authentication
        ? {
            ok: true,
            repositoryCount: authentication.repositoryCount,
            expiresAt: authentication.expiresAt,
          }
        : null,
      companion: companionScheduled ? { scheduled: true } : null,
    },
    202,
  );
}

function health(env: Env, method: string): Response {
  const webhookConfigured = Boolean(env.GITHUB_WEBHOOK_SECRET);
  const privateKeyConfigured = Boolean(env.GITHUB_PRIVATE_KEY);
  const appConfigured = Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_SLUG);
  const companionLockConfigured = Boolean(env.COMPANION_LOCK);
  const quipBankConfigured = Boolean(env.KANAREK_QUIP_KV);
  const aiConfigured = hasAiProvider(env);
  const ready =
    webhookConfigured && privateKeyConfigured && appConfigured && companionLockConfigured;
  const response = json(
    {
      ok: ready,
      service: 'kanarek-companion',
      appId: env.GITHUB_APP_ID,
      appSlug: env.GITHUB_APP_SLUG,
      webhookConfigured,
      privateKeyConfigured,
      installationAuthConfigured: privateKeyConfigured && appConfigured,
      companionLockConfigured,
      quipBankConfigured,
      aiConfigured,
    },
    ready ? 200 : 503,
  );
  if (method === 'HEAD') {
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
}

export class CommentProbeLock {
  private readonly env: Env;
  private readonly state: DurableObjectState;
  private queue: Promise<void> = Promise.resolve();

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    if (new URL(request.url).pathname === '/free-review') {
      return this.enqueue(async () => {
        let headSha = '';
        try {
          const payload = (await request.clone().json()) as {
            pull_request?: { head?: { sha?: unknown } };
          };
          const candidate = payload.pull_request?.head?.sha;
          if (typeof candidate === 'string' && /^[0-9a-f]{40}$/i.test(candidate)) {
            headSha = candidate.toLowerCase();
          }
        } catch {
          // Let the review handler report malformed payloads.
        }
        const claimKey = headSha ? `free-review:${headSha}` : '';
        if (claimKey && (await this.state.storage.get<string>(claimKey))) {
          return json({ ok: true, result: { reviewed: false, skipped: 'duplicate_head_lock' } });
        }
        if (claimKey) await this.state.storage.put(claimKey, 'in_progress');
        try {
          const result = await runFreeReviewWebhook(request, this.env);
          if (claimKey) {
            if (result?.skipped === 'providers_failed') await this.state.storage.delete(claimKey);
            else await this.state.storage.put(claimKey, 'done');
          }
          return json({ ok: true, result });
        } catch (error) {
          if (claimKey) await this.state.storage.delete(claimKey);
          throw error;
        }
      });
    }

    let target: unknown;
    try {
      target = await request.json();
    } catch {
      return json({ error: 'invalid_json' }, 400);
    }
    if (!isCompanionTarget(target)) {
      return json({ error: 'invalid_companion_target' }, 400);
    }
    if (!repositoryAllowed(this.env, target.repository)) {
      return json({ error: 'repository_not_enabled' }, 403);
    }

    if (shouldCoalesceTarget(target)) {
      return this.enqueue(() => this.queueCoalesced(target));
    }
    return this.enqueue(() => this.refreshNow(target));
  }

  async alarm(): Promise<void> {
    await this.enqueue(() => this.flushCoalesced());
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async queueCoalesced(target: CompanionTarget): Promise<Response> {
    const processed =
      (await this.state.storage.get<string[]>(PROCESSED_DELIVERIES_KEY)) ?? [];
    if (processed.includes(target.delivery)) {
      return json({ ok: true, duplicate: true, queued: false });
    }

    const pending =
      (await this.state.storage.get<string[]>(PENDING_DELIVERIES_KEY)) ?? [];
    await this.state.storage.put({
      [PENDING_TARGET_KEY]: target,
      [PENDING_DELIVERIES_KEY]: [
        target.delivery,
        ...pending.filter((delivery) => delivery !== target.delivery),
      ].slice(0, 64),
    });
    if ((await this.state.storage.getAlarm()) === null) {
      await this.state.storage.setAlarm(Date.now() + COMMENT_WINDOW_MS);
    }
    return json({ ok: true, duplicate: false, queued: true });
  }

  private async refreshNow(target: CompanionTarget): Promise<Response> {
    const pendingTarget =
      await this.state.storage.get<CompanionTarget>(PENDING_TARGET_KEY);
    const pendingDeliveries = pendingTarget
      ? ((await this.state.storage.get<string[]>(PENDING_DELIVERIES_KEY)) ?? [])
      : [];

    try {
      const payload = await this.performRefresh(target, [
        target.delivery,
        ...pendingDeliveries,
      ]);
      if (pendingTarget) {
        await this.state.storage.delete([
          PENDING_TARGET_KEY,
          PENDING_DELIVERIES_KEY,
        ]);
        await this.state.storage.deleteAlarm();
      }
      return json(payload);
    } catch (error) {
      return json(
        {
          ok: false,
          failure: operationFailure(error),
        },
        502,
      );
    }
  }

  private async flushCoalesced(): Promise<void> {
    const target = await this.state.storage.get<CompanionTarget>(PENDING_TARGET_KEY);
    if (!target) return;
    const deliveries =
      (await this.state.storage.get<string[]>(PENDING_DELIVERIES_KEY)) ?? [
        target.delivery,
      ];

    try {
      const payload = await this.performRefresh(target, deliveries);
      await this.state.storage.delete([
        PENDING_TARGET_KEY,
        PENDING_DELIVERIES_KEY,
      ]);
      console.log(
        JSON.stringify({
          companion: {
            changed: payload.result?.changed ?? false,
            coalesced: true,
            commentId: payload.result?.commentId ?? null,
            deliveryCount: deliveries.length,
            duplicate: payload.duplicate ?? false,
            quipSource: payload.result?.quipSource ?? null,
            state: payload.result?.state ?? null,
          },
          pullRequestNumber: target.pullRequestNumber,
          repository: target.repository,
          sourceEvent: target.sourceEvent,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          companion: 'coalesced_refresh_failed',
          deliveryCount: deliveries.length,
          failure: operationFailure(error),
          pullRequestNumber: target.pullRequestNumber,
          repository: target.repository,
          sourceEvent: target.sourceEvent,
        }),
      );
      throw error;
    }
  }

  private async performRefresh(
    target: CompanionTarget,
    deliveryValues: string[],
  ): Promise<CompanionLockResponse> {
    const processed =
      (await this.state.storage.get<string[]>(PROCESSED_DELIVERIES_KEY)) ?? [];
    const deliveries = [...new Set(deliveryValues)].filter(
      (delivery) => !processed.includes(delivery),
    );
    if (!deliveries.length) {
      return { ok: true, duplicate: true };
    }

    const result =
      target.sourceEvent === 'issues'
        ? await handleGptomekIssueControl(target, this.env)
        : await refreshCompanion(target, this.env);
    await this.state.storage.put(
      PROCESSED_DELIVERIES_KEY,
      [
        ...deliveries,
        ...processed.filter((delivery) => !deliveries.includes(delivery)),
      ].slice(0, 64),
    );
    return { ok: true, duplicate: false, result };
  }
}

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx?: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === HEALTH_PATH) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      return health(env, request.method);
    }

    if (url.pathname === WEBHOOK_PATH) {
      if (request.method !== 'POST') {
        return json({ error: 'method_not_allowed' }, 405);
      }
      return handleWebhook(request, env, ctx);
    }

    return json({ error: 'not_found' }, 404);
  },
};

export default worker;
export {
  COMMENT_WINDOW_MS,
  companionTargets,
  isCompanionEvent,
  readLimitedBody,
  shouldCoalesceTarget,
  verifyWebhookSignature,
  webhookMetadata,
};