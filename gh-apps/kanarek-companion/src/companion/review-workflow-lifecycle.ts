import type { ReviewTarget, StoredJob } from './webhook-review.ts';
import { objectValue } from './webhook-review-context.ts';

type Store = Pick<DurableObjectStorage, 'get' | 'put' | 'transaction'>;
type ObservedStatus = 'queued' | 'running' | 'paused' | 'waiting' | 'waitingForPause' |
  'complete' | 'errored' | 'terminated' | 'unknown';
type Handle = {
  id: string;
  status(): Promise<{ status: string; output?: unknown }>;
  terminate(): Promise<void>;
  resume(): Promise<void>;
};
export type ManagedWorkflowParams = { mode: 'managed'; job: StoredJob };
export interface ReviewWorkflowBinding {
  create(options: { id: string; params: ManagedWorkflowParams }): Promise<Handle>;
  get(id: string): Promise<Handle>;
}

export interface ManagedReview {
  id: string;
  target: ReviewTarget;
  status: ObservedStatus | 'reserved' | 'starting';
  cancelRequested: boolean;
  needsPaid: boolean;
  enqueueGeneration?: number;
}

const ACTIVE = 'review-workflow:active';
const ENQUEUE_GENERATION = 'review-workflow:enqueue-generation';

// Call inside the transaction that records an accepted webhook target.
export async function noteReviewWorkflowEnqueue(store: Pick<DurableObjectTransaction, 'get' | 'put'>): Promise<void> {
  const generation = await store.get<number>(ENQUEUE_GENERATION) ?? 0;
  // A queued event can be delayed; it invalidates freshness, not the review.
  await store.put(ENQUEUE_GENERATION, generation + 1);
}
const recordKey = (id: string) => `review-workflow:record:${id}`;
const terminal = (status: ManagedReview['status']): boolean =>
  status === 'complete' || status === 'errored' || status === 'terminated';

export async function reviewWorkflowInstanceId(target: ReviewTarget): Promise<string> {
  const key = JSON.stringify([
    target.repository.toLowerCase(), target.number, target.headSha, target.baseSha,
  ]);
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return 'review-' + Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function observedStatus(value: string): ObservedStatus {
  switch (value) {
    case 'queued': case 'running': case 'paused': case 'waiting': case 'waitingForPause':
    case 'complete': case 'errored': case 'terminated':
      return value;
    default:
      return 'unknown';
  }
}

function needsPaid(output: unknown): boolean {
  const result = objectValue(output);
  return result.mode === 'prototype' &&
    (result.status === 'completed' || result.status === 'budget') &&
    objectValue(result.publication).kind === 'escalate';
}

// One controller per PR DO. Reservation survives runtime reset and Workflow expiry.
// Ambiguous create: reconcile by ID, never issue another create for that target.
export class ReviewWorkflowLifecycle {
  private readonly store: Store;
  private readonly workflow: ReviewWorkflowBinding;
  private readonly current: (target: ReviewTarget) => Promise<boolean>;

  constructor(store: Store, workflow: ReviewWorkflowBinding, current: (target: ReviewTarget) => Promise<boolean>) {
    this.store = store;
    this.workflow = workflow;
    this.current = current;
  }

  private observe(id: string, status: ObservedStatus, output?: unknown, settleCreate = false): Promise<ManagedReview> {
    return this.store.transaction(async (txn) => {
      const record = await txn.get<ManagedReview>(recordKey(id));
      if (!record) throw new Error('review_workflow_record_missing');
      if (terminal(record.status)) return record;
      // A concurrent get() during create can report missing before dispatch settles.
      // Keep last known status during outages; only dispatch settles an ambiguous create.
      if (status === 'unknown' && (record.status !== 'starting' || !settleCreate)) return record;
      const next: ManagedReview = {
        ...record, status,
        needsPaid: status === 'complete' && !record.cancelRequested && needsPaid(output),
      };
      await txn.put(recordKey(id), next);
      return next;
    });
  }

  private async reconcile(id: string, settleCreate = false): Promise<ManagedReview | null> {
    const record = await this.store.get<ManagedReview>(recordKey(id));
    if (!record || terminal(record.status) || record.status === 'reserved') return record ?? null;
    try {
      const instance = await this.workflow.get(id);
      let status = await instance.status();
      const latest = await this.store.get<ManagedReview>(recordKey(id));
      if (latest?.cancelRequested && !terminal(observedStatus(status.status))) {
        try { await instance.terminate(); } catch { /* Re-read: may already be terminal. */ }
        status = await instance.status();
      }
      return await this.observe(id, observedStatus(status.status), status.output, settleCreate);
    } catch {
      // Missing/expired instance and transport outage are indistinguishable.
      return this.observe(id, 'unknown', undefined, settleCreate);
    }
  }

  private async cancelId(id: string): Promise<ManagedReview | null> {
    await this.store.transaction(async (txn) => {
      const record = await txn.get<ManagedReview>(recordKey(id));
      if (record && !terminal(record.status)) {
        await txn.put(recordKey(id), {
          ...record, status: record.status === 'reserved' ? 'terminated' : record.status,
          cancelRequested: true, needsPaid: false,
        });
      }
    });
    return this.reconcile(id);
  }

  async cancelIfStale(): Promise<void> {
    const active = await this.store.get<string>(ACTIVE);
    if (!active) return;
    const record = await this.store.get<ManagedReview>(recordKey(active));
    if (record && !terminal(record.status) && (record.cancelRequested || !await this.current(record.target))) {
      await this.cancelId(active);
    }
  }

  async start(job: StoredJob): Promise<ManagedReview> {
    if (job.phase === 'paid') throw new Error('review_workflow_free_only');
    const id = await reviewWorkflowInstanceId(job.target);
    const existing = await this.store.get<ManagedReview>(recordKey(id));
    if (existing && existing.status !== 'reserved') return (await this.reconcile(id)) ?? existing;

    const observedGeneration = await this.store.get<number>(ENQUEUE_GENERATION);
    const observedActive = await this.store.get<string>(ACTIVE);
    if (!await this.current(job.target)) throw new Error('review_workflow_stale_target');
    if (observedActive && observedActive !== id) {
      const previous = await this.store.get<ManagedReview>(recordKey(observedActive));
      if (previous && !terminal(previous.status)) {
        if (await this.current(previous.target)) throw new Error('review_workflow_previous_current');
        await this.cancelId(observedActive);
      }
    }
    const reservation = await this.store.transaction(async (txn) => {
      if (await txn.get<number>(ENQUEUE_GENERATION) !== observedGeneration) {
        throw new Error('review_workflow_enqueue_changed');
      }
      const record = await txn.get<ManagedReview>(recordKey(id));
      if (record) return { record };
      const active = await txn.get<string>(ACTIVE);
      if (active !== observedActive) throw new Error('review_workflow_active_changed');
      if (active) {
        const previous = await txn.get<ManagedReview>(recordKey(active));
        if (!previous || !terminal(previous.status)) throw new Error('review_workflow_previous_unsettled');
      }
      const next: ManagedReview = {
        id, target: job.target, status: 'reserved', cancelRequested: false, needsPaid: false,
        enqueueGeneration: observedGeneration,
      };
      await txn.put(recordKey(id), next);
      await txn.put(ACTIVE, id);
      return { record: next };
    });

    // Reserved (not dispatched) is recoverable. Starting/unknown never recreates.
    if (reservation.record.status === 'reserved') {
      if (!await this.current(job.target)) {
        return (await this.cancelId(id)) ?? reservation.record;
      }
      const dispatch = await this.store.transaction(async (txn) => {
        const record = await txn.get<ManagedReview>(recordKey(id));
        if (!record || record.status !== 'reserved' || record.cancelRequested || await txn.get<string>(ACTIVE) !== id) return false;
        if (await txn.get<number>(ENQUEUE_GENERATION) !== observedGeneration) {
          throw new Error('review_workflow_enqueue_changed');
        }
        await txn.put(recordKey(id), { ...record, status: 'starting', enqueueGeneration: observedGeneration });
        return true;
      });
      if (dispatch) {
        try { await this.workflow.create({ id, params: { mode: 'managed', job } }); } catch { /* Reconcile by ID. */ }
        return (await this.reconcile(id, true)) ?? reservation.record;
      }
    }
    return (await this.reconcile(id)) ?? reservation.record;
  }

  async canRun(target: ReviewTarget): Promise<boolean> {
    const id = await reviewWorkflowInstanceId(target);
    const allowed = (record: ManagedReview | undefined): record is ManagedReview =>
      Boolean(record && !record.cancelRequested &&
        ['starting', 'queued', 'running', 'paused', 'waiting', 'waitingForPause'].includes(record.status));
    const snapshot = await this.store.transaction(async (txn) => {
      if (await txn.get<string>(ACTIVE) !== id) return null;
      const record = await txn.get<ManagedReview>(recordKey(id));
      if (!allowed(record)) return null;
      return { record, generation: await txn.get<number>(ENQUEUE_GENERATION) };
    });
    if (!snapshot) return false;
    if (snapshot.record.enqueueGeneration === snapshot.generation) return true;
    // Verify against GitHub, not the potentially delayed legacy webhook.
    const fresh = await this.current(snapshot.record.target);
    return this.store.transaction(async (txn) => {
      if (await txn.get<string>(ACTIVE) !== id) return false;
      const record = await txn.get<ManagedReview>(recordKey(id));
      if (!allowed(record)) return false;
      if (await txn.get<number>(ENQUEUE_GENERATION) !== snapshot.generation) {
        throw new Error('review_workflow_enqueue_changed');
      }
      if (!fresh) return false;
      await txn.put(recordKey(id), { ...record, enqueueGeneration: snapshot.generation });
      return true;
    });
  }

  async status(target: ReviewTarget): Promise<ManagedReview | null> {
    const id = await reviewWorkflowInstanceId(target);
    const record = await this.reconcile(id);
    if (record && !terminal(record.status) && !record.cancelRequested && !await this.current(target)) {
      return this.cancelId(id);
    }
    return record;
  }

  async cancel(target: ReviewTarget): Promise<ManagedReview | null> {
    return this.cancelId(await reviewWorkflowInstanceId(target));
  }

  async resume(target: ReviewTarget): Promise<ManagedReview | null> {
    const id = await reviewWorkflowInstanceId(target);
    const record = await this.status(target);
    if (record?.status !== 'paused' || record.cancelRequested) return record;
    const instance = await this.workflow.get(id);
    try { await instance.resume(); } catch { /* Reconcile ambiguous resume. */ }
    return this.reconcile(id);
  }
}
