import assert from 'node:assert/strict';
import test from 'node:test';
import { requestManagedReviewAuthorization, reviewWorkflowCompletion, noteReviewWorkflowEnqueue, ReviewWorkflowLifecycle, reviewWorkflowInstanceId, type ReviewWorkflowBinding } from '../src/companion/review-workflow-lifecycle.ts';
import type { ReviewTarget, StoredJob } from '../src/companion/webhook-review.ts';

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
  let currentHead: string | undefined;
  let ambiguous = false;
  let missing = false;
  let statusUnavailable = false;
  let createWait: Promise<void> | undefined;
  let createEntered: (() => void) | undefined;
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
      createEntered?.();
      if (createWait) await createWait;
      if (missing) throw new Error('create unavailable');
      instances.set(id, { status: 'queued' });
      if (ambiguous) throw new Error('response lost');
      return this.get(id);
    },
    async get(id) {
      if (!instances.has(id)) throw new Error('missing');
      return {
        id,
        async status() { if (statusUnavailable) throw new Error('status unavailable'); return instances.get(id)!; },
        async terminate() { calls.push('cancel:' + id); instances.set(id, { status: 'terminated' }); },
        async resume() { calls.push('resume:' + id); instances.set(id, { status: 'running' }); },
      };
    },
  };
  const controller = (current?: (target: ReviewTarget) => Promise<boolean>) => new ReviewWorkflowLifecycle(
    store as unknown as DurableObjectStorage, workflow, current ?? (async (target) => fresh && (currentHead === undefined || target.headSha === currentHead)),
  );
  const noteEnqueue = () => store.transaction((txn) => noteReviewWorkflowEnqueue(txn as unknown as DurableObjectTransaction));
  return { data, instances, calls, controller, noteEnqueue, setFresh: (value: boolean) => { fresh = value; },
    setHead: (head: string) => { currentHead = head; },
    holdCreate: (wait: Promise<void>, entered: () => void) => { createWait = wait; createEntered = entered; },
    statusUnavailable: (value: boolean) => { statusUnavailable = value; },
    loseResponse: () => { ambiguous = true; }, failCreate: () => { missing = true; } };
}

test('instance identity binds repo, PR, head and base, not webhook delivery', async () => {
  const id = await reviewWorkflowInstanceId(job.target);
  assert.match(id, /^review-[a-f0-9]{64}$/);
  assert.equal(id, await reviewWorkflowInstanceId({ ...job.target, delivery: 'other' }));
  assert.equal(id, await reviewWorkflowInstanceId({ ...job.target, repository: 'TRVNY/trvny' }));
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

test('old start cannot cancel a newer active instance after delayed freshness', async () => {
  const f = fixture();
  let enter!: () => void;
  let release!: (value: boolean) => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const delayed = new Promise<boolean>((resolve) => { release = resolve; });
  const oldStart = f.controller(async () => { enter(); return delayed; }).start(job);
  await entered;
  const newer = await f.controller().start(updated);
  release(true);
  await assert.rejects(oldStart, /active_changed/);
  assert.deepEqual(f.calls, ['create:' + newer.id]);
});

test('accepted webhook invalidates pending freshness even before active reservation', async () => {
  const f = fixture();
  let enter!: () => void;
  let release!: (value: boolean) => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const delayed = new Promise<boolean>((resolve) => { release = resolve; });
  const start = f.controller(async () => { enter(); return delayed; }).start(job);
  await entered;
  await f.noteEnqueue();
  release(true);
  await assert.rejects(start, /enqueue_changed/);
  assert.deepEqual(f.calls, []);
});

test('concurrent missing status during create cannot revoke authorization', async () => {
  const f = fixture();
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  f.holdCreate(wait, enter);
  const pending = f.controller().start(job);
  await entered;
  assert.equal((await f.controller().status(job.target))?.status, 'starting');
  assert.equal((await f.controller().start(job)).status, 'starting');
  assert.equal(await f.controller().canRun(job.target), true);
  release();
  assert.equal((await pending).status, 'queued');
  assert.equal(f.calls.filter((call) => call.startsWith('create:')).length, 1);
});

test('delayed enqueue does not cancel current manual review; stale target cannot authorize', async () => {
  const f = fixture();
  f.setHead(updated.target.headSha);
  const first = await f.controller().start(updated);
  await f.noteEnqueue();
  assert.equal(await f.controller().canRun(updated.target), true);
  await f.controller().cancelIfStale();
  assert.equal(f.instances.get(first.id)?.status, 'queued');
  f.setHead(job.target.headSha);
  await f.noteEnqueue();
  assert.equal(await f.controller().canRun(updated.target), false);
  await f.controller().cancelIfStale();
  assert.equal(f.instances.get(first.id)?.status, 'terminated');
});

test('cancel during create revokes durable permission before the instance exists', async () => {
  const f = fixture();
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const wait = new Promise<void>((resolve) => { release = resolve; });
  f.holdCreate(wait, enter);
  const pending = f.controller().start(job);
  await entered;
  assert.equal(await f.controller().canRun(job.target), true);
  await f.controller().cancel(job.target);
  assert.equal(await f.controller().canRun(job.target), false);
  release();
  const result = await pending;
  assert.equal(result.status, 'terminated');
  assert.equal(await f.controller().canRun(job.target), false);
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
  assert.equal(await f.controller().canRun(job.target), false);
  assert.equal((await f.controller().start(job)).status, 'unknown');
  f.setHead(updated.target.headSha);
  await assert.rejects(f.controller().start(updated), /previous_unsettled/);
  assert.equal(f.calls.length, 1);
});

test('new target cancels prior instance before creating successor', async () => {
  const f = fixture();
  const first = await f.controller().start(job);
  f.setHead(updated.target.headSha);
  const second = await f.controller().start(updated);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(f.calls, ['create:' + first.id, 'cancel:' + first.id, 'create:' + second.id]);
  assert.equal((await f.controller().status(job.target))?.status, 'terminated');
});

test('terminal receipt survives instance expiry; escalation metadata only', async () => {
  const f = fixture();
  const first = await f.controller().start(job);
  f.instances.set(first.id, { status: 'complete', output: {
    mode: 'prototype', status: 'completed', publication: { kind: 'escalate', findingCount: 0 },
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


test('status outage preserves known authorization but explicit cancellation revokes it', async () => {
  const f = fixture();
  await f.controller().start(job);
  f.statusUnavailable(true);
  assert.equal((await f.controller().status(job.target))?.status, 'queued');
  assert.equal(await f.controller().canRun(job.target), true);
  await f.controller().cancel(job.target);
  assert.equal(await f.controller().canRun(job.target), false);
  f.statusUnavailable(false);
  assert.equal((await f.controller().status(job.target))?.status, 'terminated');
});


test('managed authorization retries conflict and transport failures without authorizing stale work', async () => {
  const signal = new AbortController().signal;
  let attempts = 0;
  assert.equal(await requestManagedReviewAuthorization(async () => {
    attempts += 1;
    if (attempts === 1) return new Response(null, { status: 409 });
    if (attempts === 2) throw new Error('transport');
    return Response.json({ authorized: true });
  }, signal), true);
  assert.equal(attempts, 3);
  attempts = 0;
  assert.equal(await requestManagedReviewAuthorization(async () => {
    attempts += 1;
    return new Response(null, { status: 503 });
  }, signal), false);
  assert.equal(attempts, 3);
  attempts = 0;
  assert.equal(await requestManagedReviewAuthorization(async () => {
    attempts += 1;
    return Response.json({ authorized: false });
  }, signal), false);
  assert.equal(attempts, 1);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await requestManagedReviewAuthorization(async () => {
    assert.fail('authorization must not run after abort');
  }, aborted.signal), false);
});

test('final step persists bounded completion without status polling; replay is idempotent', async () => {
  const f = fixture();
  const first = await f.controller().start(job);
  const receipt = reviewWorkflowCompletion({
    mode: 'prototype', status: 'completed',
    publication: { kind: 'escalate', findingCount: 0, text: 'discard me' },
    prompt: 'discard me',
  });
  assert.deepEqual(receipt, { status: 'completed', publication: 'escalate', findingCount: 0 });
  assert.equal(await f.controller().recordCompletion(job.target, receipt), true);
  assert.equal(await f.controller().recordCompletion(job.target, receipt), true);
  const record = f.data.get('review-workflow:record:' + first.id);
  assert.equal(JSON.stringify(record).includes('discard me'), false);
  f.instances.delete(first.id);
  const saved = await f.controller().status(job.target);
  assert.deepEqual(saved?.completion, receipt);
  assert.equal(saved?.needsPaid, false);
  assert.equal(saved?.status, 'queued');
  await assert.rejects(f.controller().recordCompletion(job.target, { ...receipt!, publication: 'silent' }), /completion_conflict/);
  await assert.rejects(f.controller().recordCompletion(job.target, { ...receipt!, findingCount: -1 }), /invalid_completion/);
});

test('cancelled or superseded Workflow cannot write a completion receipt', async () => {
  const f = fixture();
  const first = await f.controller().start(job);
  const receipt = { status: 'skipped', publication: null, findingCount: 0 };
  await f.controller().cancel(job.target);
  assert.equal(await f.controller().recordCompletion(job.target, receipt), false);
  await f.controller().start(updated);
  assert.equal(await f.controller().recordCompletion(job.target, receipt), false);
  assert.equal(JSON.stringify(f.data.get('review-workflow:record:' + first.id)).includes('"completion"'), false);
});

test('observed completion requires agreement with the durable receipt before escalation', async () => {
  const f = fixture();
  const first = await f.controller().start(job);
  await f.controller().recordCompletion(job.target, { status: 'completed', publication: 'silent', findingCount: 0 });
  f.instances.set(first.id, { status: 'complete', output: {
    mode: 'prototype', status: 'completed', publication: { kind: 'escalate', findingCount: 0 },
  } });
  const saved = await f.controller().status(job.target);
  assert.equal(saved?.needsPaid, false);
  assert.equal(saved?.completion?.publication, 'silent');
});

test('engine completion racing cancellation cannot backfill receipt', async () => {
  const f = fixture();
  const first = await f.controller().start(job);
  f.instances.set(first.id, { status: 'complete', output: {
    mode: 'prototype', status: 'completed', publication: { kind: 'escalate', findingCount: 0 },
  } });
  const saved = await f.controller().cancel(job.target);
  assert.equal(saved?.status, 'complete');
  assert.equal(saved?.cancelRequested, true);
  assert.equal(saved?.needsPaid, false);
  assert.equal(saved?.completion, undefined);
});

test('completion write rechecks freshness and enqueue generation before storing', async () => {
  const f = fixture();
  const first = await f.controller().start(job);
  const receipt = { status: 'completed', publication: 'escalate', findingCount: 0 };
  let enter!: () => void;
  let release!: (value: boolean) => void;
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const delayed = new Promise<boolean>((resolve) => { release = resolve; });
  const pending = f.controller(async () => { enter(); return delayed; }).recordCompletion(job.target, receipt);
  await entered;
  await f.noteEnqueue();
  release(true);
  await assert.rejects(pending, /enqueue_changed/);
  assert.equal(JSON.stringify(f.data.get('review-workflow:record:' + first.id)).includes('"completion"'), false);
  f.setFresh(false);
  assert.equal(await f.controller().recordCompletion(job.target, receipt), false);
  f.setFresh(true);
  assert.equal(await f.controller().recordCompletion(job.target, receipt), true);
});
