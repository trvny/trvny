import type { ReviewFile, WebhookReviewEnv } from './webhook-review-context.ts';
import {
  askReviewRouter,
  planReviewPublication,
  reviewDisposition,
  type ReviewTarget,
} from './webhook-review.ts';
import { verifyReviewFindings } from './webhook-review-judge.ts';
import { reviewWorkflowInstanceId } from './review-workflow-lifecycle.ts';
import { REVIEW_ROUTER_PAID_MODEL } from '../../../core/review-service-protocol.ts';

type Store = Pick<DurableObjectStorage, 'get' | 'put' | 'transaction'>;
type Authorization = (transaction: DurableObjectTransaction) => Promise<boolean>;
type PaidResult =
  | { kind: 'publication'; plan: ReturnType<typeof planReviewPublication> }
  | { kind: 'no_review'; reason: 'stale_target' | 'invalid_output' | 'invalid_findings' };
export type PaidReceipt =
  | { state: 'reserved'; id: string }
  | { state: 'settled'; id: string; result: PaidResult }
  | { state: 'uncertain'; id: string };

const receiptKey = (id: string) => `review-workflow:paid:${id}`;
const MAX_RECEIPT_BYTES = 96_000;

/**
 * DO-owned reservation, before the first paid I/O. Authorization must read the
 * active/free receipt and exclusive ownership in the SAME storage transaction.
 * A reserved or uncertain receipt is never replayed, even after process reset.
 */
export async function executePaidReviewOnce(
  store: Store,
  id: string,
  authorized: Authorization,
  operation: () => Promise<PaidResult>,
): Promise<PaidReceipt> {
  const key = receiptKey(id);
  const claim = await store.transaction(async (txn) => {
    const existing = await txn.get<PaidReceipt>(key);
    if (existing) return { receipt: existing, acquired: false };
    if (!await authorized(txn)) throw new Error('review_paid_not_authorized');
    const receipt: PaidReceipt = { state: 'reserved', id };
    await txn.put(key, receipt);
    return { receipt, acquired: true };
  });
  if (!claim.acquired) return claim.receipt;

  let receipt: PaidReceipt;
  try {
    const result = await operation();
    receipt = { state: 'settled', id, result };
    if (new TextEncoder().encode(JSON.stringify(receipt)).byteLength > MAX_RECEIPT_BYTES) {
      receipt = { state: 'uncertain', id };
    }
  } catch {
    receipt = { state: 'uncertain', id };
  }
  // If persistence fails, the pre-I/O reservation remains the replay barrier.
  await store.put(key, receipt);
  return receipt;
}

/**
 * Paid-stage implementation, not an entrypoint. The future DO cutover must
 * supply exclusive ownership and authorize against its durable free verdict.
 * Until then the legacy runner is the only paid caller.
 * No GitHub writes here; persist the verified publication plan for recovery.
 * Cutover gap: this stage does not withhold repeated findings yet; carry the
 * prepared `priorAnchors` here and apply `withoutRepeatedFindings` first.
 */
export async function runStrictPaidReviewStage(
  store: Store,
  target: ReviewTarget,
  input: string,
  files: ReviewFile[],
  env: WebhookReviewEnv,
  authorized: Authorization,
  current: () => Promise<boolean>,
): Promise<PaidReceipt> {
  // Explicit deny while the production alarm is active (including unset flag).
  if (env.KANAREK_WEBHOOK_REVIEW_ENABLED !== 'false') {
    throw new Error('review_paid_legacy_active');
  }
  const id = await reviewWorkflowInstanceId(target);
  return executePaidReviewOnce(store, id, authorized, async () => {
    if (!await current()) return { kind: 'no_review', reason: 'stale_target' };
    const signal = AbortSignal.timeout(7 * 60_000);
    const result = await askReviewRouter(
      input, env, REVIEW_ROUTER_PAID_MODEL, [], signal, undefined, true,
    );
    if (result.kind === 'unavailable' || signal.aborted) {
      throw new Error('review_paid_outcome_uncertain');
    }
    if (result.kind !== 'ok') return { kind: 'no_review', reason: 'invalid_output' };
    const findings = verifyReviewFindings(result.review.parsed, files);
    const disposition = reviewDisposition(result.review.parsed.findings, findings);
    if (disposition === 'invalid_findings' || result.review.partial) {
      return { kind: 'no_review', reason: 'invalid_findings' };
    }
    if (!await current()) return { kind: 'no_review', reason: 'stale_target' };
    return {
      kind: 'publication',
      plan: planReviewPublication(target, result.review, findings, true, null, null),
    };
  });
}
