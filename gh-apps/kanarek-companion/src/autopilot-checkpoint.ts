import { handleAutopilotAction } from './autopilot-actions.ts';
import type { GptActionsEnv } from './gpt-actions.ts';

const AUTOPILOT_PATH = '/gpt-actions/operator/autopilot';
const CHECKPOINT_KEY = 'checkpoint';
const CHECKPOINT_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const OPERATION_LEASE_MS = 10 * 60 * 1_000;
const MAX_CHECKPOINT_RESULT_BYTES = 128_000;
const OPERATION_ID_RE = /^op-[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/;

type JsonObject = Record<string, unknown>;
type CheckpointStatus = 'running' | 'complete' | 'uncertain';

export interface AutopilotCheckpointEnv extends GptActionsEnv {
  OPERATOR_CHECKPOINTS: DurableObjectNamespace;
}

export interface StoredAutopilotCheckpoint {
  version: 1;
  operationId: string;
  inputHash: string;
  status: CheckpointStatus;
  createdAt: number;
  updatedAt: number;
  leaseUntil: number;
  result?: {
    status: number;
    body: JsonObject;
  };
}

export type CheckpointClaimDecision =
  | { action: 'new' }
  | { action: 'complete'; result: { status: number; body: JsonObject } }
  | { action: 'in_progress'; retryAfterSeconds: number }
  | { action: 'recover' }
  | { action: 'input_mismatch' };

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', ...Object.fromEntries(new Headers(extraHeaders)) },
  });
}

function cloneObject(value: JsonObject): JsonObject {
  return structuredClone(value);
}

export function operationIdAllowed(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_ID_RE.test(value);
}

function generatedOperationId(): string {
  return `op-${crypto.randomUUID()}`;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function autopilotInputHash(input: JsonObject): Promise<string> {
  return sha256Hex(JSON.stringify(stableValue(input)));
}

export function checkpointClaimDecision(
  checkpoint: StoredAutopilotCheckpoint | null,
  inputHash: string,
  now: number,
): CheckpointClaimDecision {
  if (!checkpoint) return { action: 'new' };
  if (checkpoint.inputHash !== inputHash) return { action: 'input_mismatch' };
  if (checkpoint.status === 'complete' && checkpoint.result) {
    return { action: 'complete', result: checkpoint.result };
  }
  if (checkpoint.status === 'running' && checkpoint.leaseUntil > now) {
    return {
      action: 'in_progress',
      retryAfterSeconds: Math.max(1, Math.ceil((checkpoint.leaseUntil - now) / 1_000)),
    };
  }
  return { action: 'recover' };
}

function validCheckpoint(value: unknown): value is StoredAutopilotCheckpoint {
  if (!isObject(value)) return false;
  return (
    value.version === 1 &&
    operationIdAllowed(value.operationId) &&
    typeof value.inputHash === 'string' &&
    /^[0-9a-f]{64}$/.test(value.inputHash) &&
    (value.status === 'running' || value.status === 'complete' || value.status === 'uncertain') &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number' &&
    typeof value.leaseUntil === 'number'
  );
}

async function requestObject(request: Request, maxBytes = 160_000): Promise<JsonObject | null> {
  const text = await request.text();
  if (text.length > maxBytes) return null;
  try {
    const value = text.trim() ? JSON.parse(text) : {};
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

export class OperatorCheckpointStore {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const pathname = new URL(request.url).pathname;
    const body = await requestObject(request);
    if (!body) return json({ error: 'invalid_checkpoint_request' }, 400);

    if (pathname === '/claim') return this.claim(body);
    if (pathname === '/complete') return this.complete(body);
    if (pathname === '/uncertain') return this.uncertain(body);
    return json({ error: 'not_found' }, 404);
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }

  private async claim(body: JsonObject): Promise<Response> {
    const operationId = body.operationId;
    const inputHash = body.inputHash;
    if (!operationIdAllowed(operationId) || typeof inputHash !== 'string' || !/^[0-9a-f]{64}$/.test(inputHash)) {
      return json({ error: 'invalid_checkpoint_claim' }, 400);
    }

    const now = Date.now();
    const raw = await this.state.storage.get<StoredAutopilotCheckpoint>(CHECKPOINT_KEY);
    const checkpoint = validCheckpoint(raw) ? raw : null;
    const decision = checkpointClaimDecision(checkpoint, inputHash, now);

    if (decision.action === 'input_mismatch') {
      return json({ ok: false, state: 'input_mismatch' }, 409);
    }
    if (decision.action === 'complete') {
      return json({ ok: true, state: 'complete', result: decision.result });
    }
    if (decision.action === 'in_progress') {
      return json(
        { ok: false, state: 'in_progress', retryAfterSeconds: decision.retryAfterSeconds },
        409,
        { 'retry-after': String(decision.retryAfterSeconds) },
      );
    }

    const next: StoredAutopilotCheckpoint = {
      version: 1,
      operationId,
      inputHash,
      status: 'running',
      createdAt: checkpoint?.createdAt ?? now,
      updatedAt: now,
      leaseUntil: now + OPERATION_LEASE_MS,
    };
    await this.state.storage.put(CHECKPOINT_KEY, next);
    await this.state.storage.setAlarm(now + CHECKPOINT_RETENTION_MS);
    return json({ ok: true, state: decision.action === 'recover' ? 'recover' : 'claimed' });
  }

  private async complete(body: JsonObject): Promise<Response> {
    const inputHash = body.inputHash;
    const status = body.status;
    const resultBody = body.body;
    if (
      typeof inputHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(inputHash) ||
      typeof status !== 'number' ||
      !Number.isInteger(status) ||
      status < 100 ||
      status > 599 ||
      !isObject(resultBody)
    ) {
      return json({ error: 'invalid_checkpoint_completion' }, 400);
    }
    const encoded = JSON.stringify(resultBody);
    if (encoded.length > MAX_CHECKPOINT_RESULT_BYTES) {
      return json({ error: 'checkpoint_result_too_large' }, 413);
    }

    const raw = await this.state.storage.get<StoredAutopilotCheckpoint>(CHECKPOINT_KEY);
    if (!validCheckpoint(raw)) return json({ error: 'checkpoint_not_claimed' }, 409);
    if (raw.inputHash !== inputHash) return json({ error: 'checkpoint_input_mismatch' }, 409);

    const now = Date.now();
    const next: StoredAutopilotCheckpoint = {
      ...raw,
      status: 'complete',
      updatedAt: now,
      leaseUntil: 0,
      result: { status, body: cloneObject(resultBody) },
    };
    await this.state.storage.put(CHECKPOINT_KEY, next);
    await this.state.storage.setAlarm(now + CHECKPOINT_RETENTION_MS);
    return json({ ok: true });
  }

  private async uncertain(body: JsonObject): Promise<Response> {
    const inputHash = body.inputHash;
    if (typeof inputHash !== 'string' || !/^[0-9a-f]{64}$/.test(inputHash)) {
      return json({ error: 'invalid_checkpoint_uncertain' }, 400);
    }
    const raw = await this.state.storage.get<StoredAutopilotCheckpoint>(CHECKPOINT_KEY);
    if (!validCheckpoint(raw)) return json({ error: 'checkpoint_not_claimed' }, 409);
    if (raw.inputHash !== inputHash) return json({ error: 'checkpoint_input_mismatch' }, 409);

    const now = Date.now();
    await this.state.storage.put(CHECKPOINT_KEY, {
      ...raw,
      status: 'uncertain',
      updatedAt: now,
      leaseUntil: 0,
    } satisfies StoredAutopilotCheckpoint);
    await this.state.storage.setAlarm(now + CHECKPOINT_RETENTION_MS);
    return json({ ok: true });
  }
}

function checkpointStub(env: AutopilotCheckpointEnv, operationId: string): DurableObjectStub {
  const id = env.OPERATOR_CHECKPOINTS.idFromName(operationId);
  return env.OPERATOR_CHECKPOINTS.get(id);
}

async function checkpointCall(
  env: AutopilotCheckpointEnv,
  operationId: string,
  pathname: string,
  body: JsonObject,
): Promise<{ response: Response; payload: JsonObject }> {
  const response = await checkpointStub(env, operationId).fetch(`https://operator-checkpoint.internal${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    payload = null;
  }
  return { response, payload: isObject(payload) ? payload : {} };
}

async function parsedAutopilotRequest(request: Request): Promise<{
  operationId: string;
  input: JsonObject;
  inputHash: string;
}> {
  const text = await request.clone().text();
  if (text.length > 16_000) throw new Error('payload_too_large');
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error('invalid_json');
  }
  if (!isObject(value)) throw new Error('invalid_json_object');

  const requestedOperationId = value.operationId;
  if (requestedOperationId !== undefined && !operationIdAllowed(requestedOperationId)) {
    throw new Error('invalid_operation_id');
  }
  const input = { ...value };
  delete input.operationId;
  return {
    operationId: typeof requestedOperationId === 'string' ? requestedOperationId : generatedOperationId(),
    input,
    inputHash: await autopilotInputHash(input),
  };
}

function delegateRequest(source: Request, body: JsonObject): Request {
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(source.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function responseObject(response: Response): Promise<JsonObject> {
  try {
    const value = await response.clone().json();
    return isObject(value) ? value : { ok: false, error: 'invalid_autopilot_response' };
  } catch {
    return { ok: false, error: 'invalid_autopilot_response' };
  }
}

function operationMetadata(
  operationId: string,
  status: 'complete' | 'uncertain' | 'in_progress',
  extra: JsonObject = {},
): JsonObject {
  return {
    id: operationId,
    status,
    resumable: true,
    retentionDays: 7,
    ...extra,
  };
}

function withOperation(body: JsonObject, operation: JsonObject, recovery?: JsonObject): JsonObject {
  return {
    ...body,
    operation,
    ...(recovery ? { recovery } : {}),
  };
}

export function addAutopilotCheckpointOpenApi(document: JsonObject): void {
  const paths = isObject(document.paths) ? document.paths : null;
  const path = paths && isObject(paths[AUTOPILOT_PATH]) ? paths[AUTOPILOT_PATH] : null;
  const post = path && isObject(path.post) ? path.post : null;
  const requestBody = post && isObject(post.requestBody) ? post.requestBody : null;
  const content = requestBody && isObject(requestBody.content) ? requestBody.content : null;
  const applicationJson = content && isObject(content['application/json']) ? content['application/json'] : null;
  const schema = applicationJson && isObject(applicationJson.schema) ? applicationJson.schema : null;
  const properties = schema && isObject(schema.properties) ? schema.properties : null;
  if (!post || !properties) return;

  post.description =
    'Runs the guarded operator loop with a resumable Durable Object checkpoint. Provide a stable operationId before the first call for safe retries after client timeouts; uncertain retries recover read-only instead of replaying mutations.';
  properties.operationId = {
    type: 'string',
    pattern: '^op-[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$',
    description: 'Stable client-generated operation ID. Reuse the same value to resume or replay the result safely.',
  };
}

export async function handleResumableAutopilotAction(
  request: Request,
  env: AutopilotCheckpointEnv,
  fetcher: typeof fetch,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== AUTOPILOT_PATH) return null;
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let parsed: Awaited<ReturnType<typeof parsedAutopilotRequest>>;
  try {
    parsed = await parsedAutopilotRequest(request);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'invalid_autopilot_request' }, 400);
  }

  if (!env.OPERATOR_CHECKPOINTS) {
    return json({ ok: false, error: 'operator_checkpoint_storage_unavailable' }, 503);
  }

  const claim = await checkpointCall(env, parsed.operationId, '/claim', {
    operationId: parsed.operationId,
    inputHash: parsed.inputHash,
  });

  if (claim.payload.state === 'input_mismatch') {
    return json({
      ok: false,
      error: 'operation_input_mismatch',
      operation: operationMetadata(parsed.operationId, 'uncertain'),
    }, 409);
  }
  if (claim.payload.state === 'in_progress') {
    const retryAfterSeconds =
      typeof claim.payload.retryAfterSeconds === 'number' ? claim.payload.retryAfterSeconds : 30;
    return json(
      {
        ok: false,
        error: 'operation_in_progress',
        retryAfterSeconds,
        operation: operationMetadata(parsed.operationId, 'in_progress'),
      },
      409,
      { 'retry-after': String(retryAfterSeconds) },
    );
  }
  if (claim.payload.state === 'complete' && isObject(claim.payload.result)) {
    const storedStatus = claim.payload.result.status;
    const storedBody = claim.payload.result.body;
    if (typeof storedStatus === 'number' && isObject(storedBody)) {
      return json(
        withOperation(
          storedBody,
          operationMetadata(parsed.operationId, 'complete', { resumed: true, replayed: true }),
        ),
        storedStatus,
      );
    }
  }
  if (!claim.response.ok && claim.payload.state !== 'recover') {
    return json({ ok: false, error: 'checkpoint_claim_failed' }, 502);
  }

  const recoveryMode = claim.payload.state === 'recover';
  const delegateInput = recoveryMode ? { ...parsed.input, dryRun: true } : parsed.input;
  let delegateResponse: Response;
  try {
    const response = await handleAutopilotAction(delegateRequest(request, delegateInput), env, fetcher);
    if (!response) throw new Error('autopilot_route_missing');
    delegateResponse = response;
  } catch (error) {
    await checkpointCall(env, parsed.operationId, '/uncertain', { inputHash: parsed.inputHash });
    return json({
      ok: false,
      error: 'operator_autopilot_uncertain',
      detail: error instanceof Error ? error.message.slice(0, 300) : 'unknown_error',
      operation: operationMetadata(parsed.operationId, 'uncertain', { resumeSafe: true }),
    }, 500);
  }

  const delegateBody = await responseObject(delegateResponse);
  const recovery = recoveryMode
    ? {
        resumedAfterInterruptedRun: true,
        mutationReplaySuppressed: true,
        mode: 'verification_only',
        instruction:
          'A prior run lost its completion checkpoint. This pass was forced read-only to avoid replaying uncertain mutations. Continue from the fresh verified task queue; start a new operation for any remaining safe maintenance.',
      }
    : undefined;

  if (delegateResponse.status >= 500) {
    await checkpointCall(env, parsed.operationId, '/uncertain', { inputHash: parsed.inputHash });
    return json(
      withOperation(
        delegateBody,
        operationMetadata(parsed.operationId, 'uncertain', { resumeSafe: true }),
        recovery,
      ),
      delegateResponse.status,
    );
  }

  const finalBody = withOperation(
    delegateBody,
    operationMetadata(parsed.operationId, 'complete', {
      resumed: recoveryMode,
      replayed: false,
      clientSuppliedIdRecommended: true,
    }),
    recovery,
  );
  const completion = await checkpointCall(env, parsed.operationId, '/complete', {
    inputHash: parsed.inputHash,
    status: delegateResponse.status,
    body: finalBody,
  });
  if (!completion.response.ok) {
    return json({
      ...finalBody,
      checkpointWarning: 'checkpoint_completion_failed',
    }, delegateResponse.status);
  }
  return json(finalBody, delegateResponse.status);
}
