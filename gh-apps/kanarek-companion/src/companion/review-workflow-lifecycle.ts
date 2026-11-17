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
export interface ReviewWorkflowBinding {
  create(options: { id: string; params: StoredJob }): Promise<Handle>;
  get(id: string): Promise<Handle>;
}

export interface ManagedReview {
  id: string;
  target: ReviewTarget;
  status: ObservedStatus | 'starting';
  cancelRequested: boolean;
  needsPaid: boolean;
}

const ACTIVE = 'review-workflow:active';
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
  constructor(
    private readonly store: Store,
    private readonly workflow: ReviewWorkflowBinding,
    private readonly current: (target: ReviewTarget) => Promise<boolean>,
  ) {}

  private async observe(id: string, status: ObservedStatus, output?: unknown): Promise<ManagedReview> {
    return this.store.transaction(async (txn) => {
      const record = await txn.get<ManagedReview>(recordKey(id));
      if (!record) throw new Error('review_workflow_record_missing');
      if (terminal(record.status)) return record;
      const next: ManagedReview = {
        ...record, status,
        needsPaid: status === 'complete' && !record.cancelRequested && needsPaid(output),
      };
      await txn.put(recordKey(id), next);
      return next;
    });
  }

  private async reconcile(id: string): Promise<ManagedReview | null> {
    const record = await this.store.get<ManagedReview>(recordKey(id));
    if (!record || terminal(record.status)) return record ?? null;
    try {
      const instance = await this.workflow.get(id);
      let status = await instance.status();
      const latest = await this.store.get<ManagedReview>(recordKey(id));
      if (latest?.cancelRequested && !terminal(observedStatus(status.status))) {
        try { await instance.terminate(); } catch { /* Re-read: may already be terminal. */ }
        status = await instance.status();
      }
      return this.observe(id, observedStatus(status.status), status.output);
    } catch {
      // Missing/expired instance and transport outage are indistinguishable.
      return this.observe(id, 'unknown');
    }
  }

  private async cancelId(id: string): Promise<ManagedReview | null> {
    await this.store.transaction(async (txn) => {
      const record = await txn.get<ManagedReview>(recordKey(id));
      if (record && !terminal(record.status)) {
        await txn.put(recordKey(id), { ...record, cancelRequested: true, needsPaid: false });
      }
    });
    return this.reconcile(id);
  }

  async cancelSuperseded(target: ReviewTarget): Promise<void> {
    const active = await this.store.get<string>(ACTIVE);
    if (active && active !== await reviewWorkflowInstanceId(target)) {
      await this.cancelId(active);
    }
  }

  async start(job: StoredJob): Promise<ManagedReview> {
    if (job.phase === 'paid') throw new Error('review_workflow_free_only');
    const id = await reviewWorkflowInstanceId(job.target);
    const existing = await this.store.get<ManagedReview>(recordKey(id));
    if (existing) return (await this.reconcile(id)) ?? existing;

    if (!await this.current(job.target)) throw new Error('review_workflow_stale_target');
    await this.cancelSuperseded(job.target);
    const reservation = await this.store.transaction(async (txn) => {
      const record = await txn.get<ManagedReview>(recordKey(id));
      if (record) return { record, created: false };
      const active = await txn.get<string>(ACTIVE);
      if (active) {
        const previous = await txn.get<ManagedReview>(recordKey(active));
        if (!previous || !terminal(previous.status)) throw new Error('review_workflow_previous_unsettled');
      }
      const next: ManagedReview = {
        id, target: job.target, status: 'starting', cancelRequested: false, needsPaid: false,
      };
      await txn.put(recordKey(id), next);
      await txn.put(ACTIVE, id);
      return { record: next, created: true };
    });

    if (reservation.created) {
      // The reservation precedes external I/O. On crash/timeout, never recreate.
      try { await this.workflow.create({ id, params: job }); } catch { /* Reconcile by ID. */ }
    }
    return (await this.reconcile(id)) ?? reservation.record;
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
