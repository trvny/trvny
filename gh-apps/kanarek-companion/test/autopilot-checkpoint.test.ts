import assert from 'node:assert/strict';
import test from 'node:test';

import {
  autopilotInputHash,
  checkpointClaimDecision,
  operationIdAllowed,
  type StoredAutopilotCheckpoint,
} from '../src/autopilot-checkpoint.ts';

function checkpoint(
  overrides: Partial<StoredAutopilotCheckpoint> = {},
): StoredAutopilotCheckpoint {
  return {
    version: 1,
    operationId: 'op-12345678',
    inputHash: 'a'.repeat(64),
    status: 'running',
    createdAt: 1_000,
    updatedAt: 1_000,
    leaseUntil: 20_000,
    ...overrides,
  };
}

test('operation IDs are explicit, bounded and namespaced', () => {
  assert.equal(operationIdAllowed('op-12345678'), true);
  assert.equal(operationIdAllowed('12345678'), false);
  assert.equal(operationIdAllowed('op-short'), false);
  assert.equal(operationIdAllowed(`op-${'a'.repeat(97)}`), false);
});

test('autopilot input hashing is stable across object key order', async () => {
  const left = await autopilotInputHash({
    repositories: ['trvny/feedseek'],
    dryRun: false,
    maxTasks: 8,
  });
  const right = await autopilotInputHash({
    maxTasks: 8,
    dryRun: false,
    repositories: ['trvny/feedseek'],
  });
  assert.equal(left, right);
  assert.match(left, /^[0-9a-f]{64}$/);
});

test('checkpoint claims replay completed work and do not duplicate active work', () => {
  const now = 5_000;
  assert.deepEqual(checkpointClaimDecision(null, 'a'.repeat(64), now), { action: 'new' });
  assert.deepEqual(checkpointClaimDecision(checkpoint(), 'a'.repeat(64), now), {
    action: 'in_progress',
    retryAfterSeconds: 15,
  });

  const result = { status: 200, body: { ok: true } };
  assert.deepEqual(
    checkpointClaimDecision(
      checkpoint({ status: 'complete', leaseUntil: 0, result }),
      'a'.repeat(64),
      now,
    ),
    { action: 'complete', result },
  );
});

test('expired, paused or uncertain work recovers without replaying mutations', () => {
  const now = 30_000;
  assert.deepEqual(
    checkpointClaimDecision(checkpoint({ leaseUntil: 20_000 }), 'a'.repeat(64), now),
    { action: 'recover' },
  );
  assert.deepEqual(
    checkpointClaimDecision(
      checkpoint({
        status: 'paused',
        leaseUntil: 0,
        progress: { stage: 'waiting_workflow', runId: 123 },
      }),
      'a'.repeat(64),
      now,
    ),
    { action: 'recover' },
  );
  assert.deepEqual(
    checkpointClaimDecision(
      checkpoint({ status: 'uncertain', leaseUntil: 0 }),
      'a'.repeat(64),
      now,
    ),
    { action: 'recover' },
  );
  assert.deepEqual(checkpointClaimDecision(checkpoint(), 'b'.repeat(64), now), {
    action: 'input_mismatch',
  });
});

test('checkpoint release removes a completed resource lock', async () => {
  const records = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => records.get(key),
    put: async (key: string, value: unknown) => { records.set(key, value); },
    delete: async (key: string) => records.delete(key),
    deleteAll: async () => { records.clear(); },
    setAlarm: async () => undefined,
    deleteAlarm: async () => undefined,
  };
  const { OperatorCheckpointStore } = await import('../src/autopilot-checkpoint.ts');
  const store = new OperatorCheckpointStore({ storage } as unknown as DurableObjectState);
  const call = (pathname: string, body: Record<string, unknown>) => store.fetch(new Request(
    `https://checkpoint.internal${pathname}`,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
  ));
  const operationId = 'op-resource-lock';
  const firstHash = 'a'.repeat(64);
  const secondHash = 'b'.repeat(64);
  assert.equal((await call('/claim', { operationId, inputHash: firstHash })).status, 200);
  assert.equal((await call('/release', { inputHash: firstHash })).status, 200);
  const next = await call('/claim', { operationId, inputHash: secondHash });
  assert.equal(next.status, 200);
  assert.equal((await next.json() as { state?: string }).state, 'claimed');
});