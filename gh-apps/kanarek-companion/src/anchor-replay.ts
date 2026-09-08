import { isObject, type JsonObject } from './tools/common.ts';

const CONNECTION_NAME = 'trvny';
const ACTIVE_KEY = 'active';
const RECEIPT_PREFIX = 'receipt:';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const OPERATION_ID_RE = /^op-[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

type ReceiptStatus = 'running' | 'complete' | 'uncertain';

export interface AnchorMutationReplayEnv {
  ANCHOR_MUTATION_REPLAYS?: DurableObjectNamespace;
}

interface ActiveMutation {
  operationId: string;
  inputHash: string;
}

interface MutationReceipt {
  version: 1;
  operationId: string;
  inputHash: string;
  status: ReceiptStatus;
  createdAt: number;
  updatedAt: number;
}

export class AnchorReplayError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 409) {
    super(code);
    this.name = 'AnchorReplayError';
    this.code = code;
    this.status = status;
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' },
  });
}

function validOperationId(value: unknown): value is string {
  return typeof value === 'string' && OPERATION_ID_RE.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_RE.test(value);
}

function receiptKey(operationId: string): string {
  return `${RECEIPT_PREFIX}${operationId}`;
}

function validReceipt(value: unknown): value is MutationReceipt {
  if (!isObject(value)) return false;
  return (
    value.version === 1 &&
    validOperationId(value.operationId) &&
    validHash(value.inputHash) &&
    (value.status === 'running' || value.status === 'complete' || value.status === 'uncertain') &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  );
}

function validActive(value: unknown): value is ActiveMutation {
  return isObject(value) && validOperationId(value.operationId) && validHash(value.inputHash);
}

async function requestObject(request: Request): Promise<JsonObject | null> {
  try {
    const value: unknown = await request.json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

export class AnchorMutationReplayStore {
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const body = await requestObject(request);
    if (!body) return json({ error: 'invalid_anchor_replay_request' }, 400);

    const pathname = new URL(request.url).pathname;
    return this.state.blockConcurrencyWhile(async () => {
      if (pathname === '/claim') return this.claim(body);
      if (pathname === '/complete') return this.complete(body);
      if (pathname === '/release') return this.release(body);
      if (pathname === '/uncertain') return this.uncertain(body);
      return json({ error: 'not_found' }, 404);
    });
  }

  async alarm(): Promise<void> {
    await this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const receipts = await this.state.storage.list<MutationReceipt>({ prefix: RECEIPT_PREFIX });
      const expired: string[] = [];
      let nextAlarm: number | null = null;
      for (const [key, receipt] of receipts) {
        if (!validReceipt(receipt) || receipt.updatedAt + RETENTION_MS <= now) {
          expired.push(key);
          continue;
        }
        const candidate = receipt.updatedAt + RETENTION_MS;
        nextAlarm = nextAlarm === null ? candidate : Math.min(nextAlarm, candidate);
      }
      if (expired.length) await this.state.storage.delete(expired);

      const active = await this.state.storage.get<ActiveMutation>(ACTIVE_KEY);
      if (validActive(active)) {
        const receipt = await this.state.storage.get<MutationReceipt>(receiptKey(active.operationId));
        if (!validReceipt(receipt) || receipt.status !== 'running') {
          await this.state.storage.delete(ACTIVE_KEY);
        }
      }
      if (nextAlarm !== null) await this.state.storage.setAlarm(nextAlarm);
    });
  }

  private async scheduleCleanup(now: number): Promise<void> {
    const current = await this.state.storage.getAlarm();
    const candidate = now + RETENTION_MS;
    if (current === null || candidate < current) {
      await this.state.storage.setAlarm(candidate);
    }
  }

  private async claim(body: JsonObject): Promise<Response> {
    const operationId = body.operationId;
    const inputHash = body.inputHash;
    if (!validOperationId(operationId) || !validHash(inputHash)) {
      return json({ error: 'invalid_anchor_mutation_claim' }, 400);
    }

    const rawReceipt = await this.state.storage.get<MutationReceipt>(receiptKey(operationId));
    if (validReceipt(rawReceipt)) {
      if (rawReceipt.inputHash !== inputHash) {
        return json({ ok: false, state: 'input_mismatch' }, 409);
      }
      if (rawReceipt.status === 'complete') {
        return json({ ok: true, state: 'complete' });
      }
      return json({ ok: false, state: rawReceipt.status }, 409);
    }

    const rawActive = await this.state.storage.get<ActiveMutation>(ACTIVE_KEY);
    if (validActive(rawActive)) {
      return json({ ok: false, state: 'busy' }, 409);
    }

    const now = Date.now();
    const receipt: MutationReceipt = {
      version: 1,
      operationId,
      inputHash,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };
    await this.state.storage.put({
      [ACTIVE_KEY]: { operationId, inputHash } satisfies ActiveMutation,
      [receiptKey(operationId)]: receipt,
    });
    await this.scheduleCleanup(now);
    return json({ ok: true, state: 'claimed' });
  }

  private async complete(body: JsonObject): Promise<Response> {
    const operationId = body.operationId;
    const inputHash = body.inputHash;
    if (!validOperationId(operationId) || !validHash(inputHash)) {
      return json({ error: 'invalid_anchor_mutation_completion' }, 400);
    }

    const key = receiptKey(operationId);
    const rawReceipt = await this.state.storage.get<MutationReceipt>(key);
    if (!validReceipt(rawReceipt) || rawReceipt.inputHash !== inputHash) {
      return json({ error: 'anchor_mutation_not_claimed' }, 409);
    }
    const now = Date.now();
    await this.state.storage.put(key, {
      ...rawReceipt,
      status: 'complete',
      updatedAt: now,
    } satisfies MutationReceipt);
    await this.clearActive(operationId, inputHash);
    await this.scheduleCleanup(now);
    return json({ ok: true });
  }

  private async release(body: JsonObject): Promise<Response> {
    const operationId = body.operationId;
    const inputHash = body.inputHash;
    if (!validOperationId(operationId) || !validHash(inputHash)) {
      return json({ error: 'invalid_anchor_mutation_release' }, 400);
    }
    const key = receiptKey(operationId);
    const rawReceipt = await this.state.storage.get<MutationReceipt>(key);
    if (validReceipt(rawReceipt) && rawReceipt.inputHash === inputHash && rawReceipt.status === 'running') {
      await this.state.storage.delete(key);
    }
    await this.clearActive(operationId, inputHash);
    return json({ ok: true });
  }

  private async uncertain(body: JsonObject): Promise<Response> {
    const operationId = body.operationId;
    const inputHash = body.inputHash;
    if (!validOperationId(operationId) || !validHash(inputHash)) {
      return json({ error: 'invalid_anchor_mutation_uncertain' }, 400);
    }
    const key = receiptKey(operationId);
    const rawReceipt = await this.state.storage.get<MutationReceipt>(key);
    if (!validReceipt(rawReceipt) || rawReceipt.inputHash !== inputHash) {
      return json({ error: 'anchor_mutation_not_claimed' }, 409);
    }
    const now = Date.now();
    await this.state.storage.put(key, {
      ...rawReceipt,
      status: 'uncertain',
      updatedAt: now,
    } satisfies MutationReceipt);
    await this.clearActive(operationId, inputHash);
    await this.scheduleCleanup(now);
    return json({ ok: true });
  }

  private async clearActive(operationId: string, inputHash: string): Promise<void> {
    const rawActive = await this.state.storage.get<ActiveMutation>(ACTIVE_KEY);
    if (
      validActive(rawActive) &&
      rawActive.operationId === operationId &&
      rawActive.inputHash === inputHash
    ) {
      await this.state.storage.delete(ACTIVE_KEY);
    }
  }
}

function replayStub(env: AnchorMutationReplayEnv): DurableObjectStub {
  if (!env.ANCHOR_MUTATION_REPLAYS) {
    throw new AnchorReplayError('anchor_mutation_guard_not_configured', 503);
  }
  const id = env.ANCHOR_MUTATION_REPLAYS.idFromName(CONNECTION_NAME);
  return env.ANCHOR_MUTATION_REPLAYS.get(id);
}

async function replayCall(
  env: AnchorMutationReplayEnv,
  pathname: string,
  body: JsonObject,
): Promise<{ response: Response; payload: JsonObject }> {
  const response = await replayStub(env).fetch(`https://anchor-replay.internal${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    value = {};
  }
  return { response, payload: isObject(value) ? value : {} };
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

export async function anchorMutationInputHash(value: JsonObject): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(stableValue(value))),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function claimAnchorMutation(
  env: AnchorMutationReplayEnv,
  operationId: string,
  inputHash: string,
): Promise<{ state: 'claimed' } | { state: 'complete' }> {
  const { response, payload } = await replayCall(env, '/claim', { operationId, inputHash });
  if (response.ok && payload.state === 'claimed') return { state: 'claimed' };
  if (response.ok && payload.state === 'complete') return { state: 'complete' };
  const state = typeof payload.state === 'string' ? payload.state : 'failed';
  const code =
    state === 'input_mismatch'
      ? 'anchor_operation_id_reused'
      : state === 'busy'
        ? 'anchor_mutation_busy'
        : state === 'uncertain'
          ? 'anchor_mutation_uncertain'
          : state === 'running'
            ? 'anchor_mutation_in_progress'
            : typeof payload.error === 'string'
              ? payload.error
              : 'anchor_mutation_guard_failed';
  throw new AnchorReplayError(code, response.status >= 400 ? response.status : 502);
}

export async function completeAnchorMutation(
  env: AnchorMutationReplayEnv,
  operationId: string,
  inputHash: string,
): Promise<void> {
  const { response, payload } = await replayCall(env, '/complete', { operationId, inputHash });
  if (!response.ok) {
    throw new AnchorReplayError(
      typeof payload.error === 'string' ? payload.error : 'anchor_mutation_completion_failed',
      response.status,
    );
  }
}

export async function releaseAnchorMutation(
  env: AnchorMutationReplayEnv,
  operationId: string,
  inputHash: string,
): Promise<void> {
  await replayCall(env, '/release', { operationId, inputHash });
}

export async function markAnchorMutationUncertain(
  env: AnchorMutationReplayEnv,
  operationId: string,
  inputHash: string,
): Promise<void> {
  await replayCall(env, '/uncertain', { operationId, inputHash });
}
