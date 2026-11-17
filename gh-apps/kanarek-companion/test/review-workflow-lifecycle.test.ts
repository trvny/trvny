import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewWorkflowLifecycle, reviewWorkflowInstanceId, type ReviewWorkflowBinding } from '../src/companion/review-workflow-lifecycle.ts';
import type { StoredJob } from '../src/companion/webhook-review.ts';

const job: StoredJob = { target: {
  repository: 'trvny/trvny', number: 42, installationId: 123, action: 'synchronize',
  delivery: 'test', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40),
} };
const updated: StoredJob = { target: { ...job.target, headSha: 'c'.repeat(40) } };

function fixture() {
  const data = new Map<string, unknown>();
  const instances = new Map<string, { status: string; output?: unknown }>();
  const calls: string[] = [];
  let fresh = true;
  let ambiguous = false;
  let missing = false;
  let tail = Promise.resolve();
  const store = {
    async get(key: string) { return data.get(key); },
    async put(key: string, value: unknown) { data.set(key, value); },
    transaction<T>(callback: (txn: typeof store) => Promise<T>) {
      const result = tail.then(() => callback(store));
      tail = result.then(() => {}, () => {});
      return result;
    },
  };
  const workflow: ReviewWorkflowBinding = {
    async create({ id }) {
      calls.push('create:' + id);
      if (missing) throw new Error('create unavailable');
      instances.set(id, { status: 'queued' });
      if (ambiguous) throw new Error('response lost');
      return this.get(id);
    },
    async get(id) {
      if (!instances.has(id)) throw new Error('missing');
      return {
        id,
        async status() { return instances.get(id)!; },
        async terminate() { calls.push('cancel:' + id); instances.set(id, { status: 'terminated' }); },
        async resume() { calls.push('resume:' + id); instances.set(id, { status: 'running' }); },
      };
    },
  };
  const controller = () => new ReviewWorkflowLifecycle(
    store as unknown as DurableObjectStorage, workflow, async () => fresh,
  );
  return { data, instances, calls, controller, setFresh: (value: boolean) => { fresh = value; },
    loseResponse: () => { ambiguous = true; }, failCreate: () => { missing = true; } };
}

test('instance identity binds repo, PR, head and base, not webhook delivery', async () => {
  const id = await reviewWorkflowInstanceId(job.target);
  assert.match(id, /^review-[a-f0-9]{64}$/);
  assert.equal(id, await reviewWorkflowInstanceId({ ...job.target, delivery: 'other' }));
  for (const target of [updated.target, { ...job.target, baseSha: 'd'.repeat(40) },
    { ...job.target, number: 43 }, { ...job.target, repository: 'travnie/other' }]) {
    assert.notEqual(id, await reviewWorkflowInstanceId(target));
  }
});

test('concurrent starts and runtime reset create only one instance', async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.controller().start(job), f.controller().start(job)]);
  assert.equal(a.id, b.id);
  const c = await f.controller().start(job);
  assert.equal(c.status, 'queued');
  assert.equal(f.calls.filter((call) => call.startsWith('create:')).length, 1);
});

test('ambiguous create recovers existing instance without repeat creation', async () => {
  const f = fixture();
  f.loseResponse();
  assert.equal((await f.controller().start(job)).status, 'queued');
  assert.equal((await f.controller().start(job)).status, 'queued');
  assert.equal(f.calls.length, 1);
});

test('unknown reservation fails closed across reset and blocks supersession', async () => {
  const f = fixture();
  f.failCreate();
  assert.equal((await f.controller().start(job)).status, 'unknown');
  assert.equal((await f.controller().start(job)).status, 'unknown');
  await assert.rejects(f.controller().start(updated), /previous_unsettled/);
  assert.equal(f.calls.length, 1);
});

test('new target cancels prior instance before creating successor', async () => {
  const f = fixture();
  const first = await f.controller().start(job);
  const second = await f.controller().start(updated);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(f.calls, ['create:' + first.id, 'cancel:' + first.id, 'create:' + second.id]);
  assert.equal((await f.controller().status(job.target))?.status, 'terminated');
});

test('terminal receipt survives instance expiry; escalation metadata only', async () => {
  const f = fixture();
  const first = await f.controller().start(job);
  f.instances.set(first.id, { status: 'complete', output: {
    mode: 'prototype', status: 'completed', publication: { kind: 'escalate' },
    secret: 'not stored',
  } });
  const complete = await f.controller().status(job.target);
  assert.equal(complete?.needsPaid, true);
  assert.equal(JSON.stringify(complete).includes('not stored'), false);
  f.instances.delete(first.id);
  assert.deepEqual(await f.controller().start(job), complete);
  assert.equal(f.calls.length, 1);
});

test('resume only paused and current; stale target cancels without resume', async () => {
  const f = fixture();
  const first = await f.controller().start(job);
  f.instances.set(first.id, { status: 'paused' });
  assert.equal((await f.controller().resume(job.target))?.status, 'running');
  f.instances.set(first.id, { status: 'paused' });
  f.setFresh(false);
  assert.equal((await f.controller().resume(job.target))?.status, 'terminated');
  assert.deepEqual(f.calls, ['create:' + first.id, 'resume:' + first.id, 'cancel:' + first.id]);
  await assert.rejects(f.controller().start(updated), /stale_target/);
});
