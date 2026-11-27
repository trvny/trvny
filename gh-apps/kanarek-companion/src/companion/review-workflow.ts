import type { WorkflowStep } from 'cloudflare:workers';
import { createInstallationClient } from '../../../core/github-app.ts';
import {
  isFreeReviewProvider,
  REVIEW_ROUTER_CODE_REVIEW_MODEL,
  type ReviewProviderPoolHealth,
} from '../../../core/review-service-protocol.ts';
import { reviewProviderPoolHealthViaService } from './review-service.ts';
import { runtimeFetch, type ReviewFile, type WebhookReviewEnv } from './webhook-review-context.ts';
import {
  askDecisionJudge,
  askReviewJudge,
  findingsAfterJudge,
  focusedReviewJudgeContext,
  type JudgedFindings,
} from './webhook-review-judge.ts';
import {
  askReviewRouter,
  assertFreeReviewWorkflowJob,
  emptySweepSkip,
  planReviewPublication,
  prepareWebhookReview,
  reviewRouterEnvForAttempt,
  reviewSweepMaxAttempts,
  reviewTargetIsCurrent,
  sweepReviewAttempts,
  withoutRepeatedFindings,
  type PreparedWebhookReview,
  type ReviewRouterOutcome,
  type ReviewSweepAttempt,
  type ReviewSweepResult,
  type ReviewTarget,
  type StoredJob,
} from './webhook-review.ts';

const FREE_BUDGET_MS = 45 * 60_000;
const PROVIDER_TIMEOUT_MS = 7 * 60_000;
const FRESHNESS_TIMEOUT_MS = 30_000;
const SNAPSHOT_MAX_BYTES = 900_000;
const READ_STEP = { retries: { limit: 0, delay: '1 second' }, timeout: '5 minutes' } as const;
const PROVIDER_STEP = { retries: { limit: 0, delay: '1 second' }, timeout: '8 minutes' } as const;
const DECISION_STEP = { retries: { limit: 0, delay: '1 second' }, timeout: '90 seconds' } as const;
const JUDGE_STEP = { retries: { limit: 0, delay: '1 second' }, timeout: '6 minutes' } as const;

type ReadyReview = Extract<PreparedWebhookReview, { kind: 'ready' }>;
type Snapshot = Exclude<PreparedWebhookReview, ReadyReview> | (
  Omit<ReadyReview, 'verifiableFiles'> & {
    verifiableFiles: Array<Omit<ReviewFile, 'rightLines'> & { rightLines: number[] }>;
  }
);

// Steps persist the returned string, including its outer JSON escaping.
function fitsStepOutput(value: string): boolean {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength <= SNAPSHOT_MAX_BYTES;
}

export function serializeReviewSnapshot(prepared: PreparedWebhookReview): string {
  const snapshot: Snapshot = prepared.kind === 'finished' ? prepared : {
    ...prepared,
    verifiableFiles: prepared.verifiableFiles.map((file) => ({ ...file, rightLines: [...file.rightLines] })),
  };
  const value = JSON.stringify(snapshot);
  if (!fitsStepOutput(value)) {
    throw new Error('review_workflow_snapshot_too_large');
  }
  return value;
}

export function restoreReviewSnapshot(value: string): PreparedWebhookReview {
  const snapshot = JSON.parse(value) as Snapshot;
  if (snapshot.kind === 'finished') return snapshot;
  return {
    ...snapshot,
    verifiableFiles: snapshot.verifiableFiles.map((file) => ({ ...file, rightLines: new Set(file.rightLines) })),
  };
}

type StopReason = 'budget' | 'stale';
type Checkpoint = { attempt: ReviewSweepAttempt; stopped: StopReason | null };
type StepRunner = Pick<WorkflowStep, 'do'>;
// Shared callback type; argument names are type-only, not runtime bindings.
type AbortableCallback<Result, Args extends unknown[] = []> = (..._args: [...Args, AbortSignal]) => Promise<Result>;

export function workflowFreeOrder(configured: unknown): string[] {
  if (!Array.isArray(configured) || !configured.every((id) => isFreeReviewProvider(id) || id === 'workers-ai')) {
    throw new Error('review_workflow_order_unavailable');
  }
  const order = [...new Set(configured.filter(isFreeReviewProvider))];
  if (!order.length) throw new Error('review_workflow_order_unavailable');
  return order;
}

export function workflowRouteOrder(health: ReviewProviderPoolHealth): string[] {
  if (health.strictFreeReviewSelector !== true) {
    throw new Error('review_workflow_router_selector_unsupported');
  }
  return workflowFreeOrder(health.taskOrders?.review);
}

export function workflowProviderAt(order: readonly string[], index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= order.length) {
    throw new Error('review_workflow_invalid_provider_index');
  }
  const provider = order.at(index);
  if (!isFreeReviewProvider(provider)) throw new Error('review_workflow_invalid_provider_index');
  return provider;
}

export function workflowStatus(stopped: StopReason | null, stillCurrent: boolean): 'stale' | 'budget' | 'completed' {
  if (!stillCurrent || stopped === 'stale') return 'stale';
  if (stopped === 'budget') return 'budget';
  return 'completed';
}

export async function checkpointFreeSweep(
  step: StepRunner,
  order: readonly string[],
  deadlineAt: number,
  files: ReviewFile[],
  current: AbortableCallback<boolean>,
  ask: AbortableCallback<ReviewRouterOutcome, [provider: string]>,
  now: () => number = Date.now,
) {
  const providers = workflowFreeOrder(order);
  const state: { stopped: StopReason | null } = { stopped: null };
  const sweep = await sweepReviewAttempts(async (_excluded, index) => {
    const provider = workflowProviderAt(providers, index);
    const saved = await step.do(`free-${index + 1}-${provider}`, PROVIDER_STEP, async () => {
      const stop = (reason: StopReason): Checkpoint => ({ attempt: { kind: 'stop' }, stopped: reason });
      const freshnessBudgetMs = deadlineAt - now();
      if (freshnessBudgetMs <= 0) return JSON.stringify(stop('budget'));
      const freshnessSignal = AbortSignal.timeout(Math.min(FRESHNESS_TIMEOUT_MS, freshnessBudgetMs));
      let stillCurrent: boolean;
      try {
        stillCurrent = await current(freshnessSignal);
      } catch (error) {
        if (now() >= deadlineAt || (freshnessSignal.aborted && freshnessBudgetMs <= FRESHNESS_TIMEOUT_MS)) {
          return JSON.stringify(stop('budget'));
        }
        // Failed freshness checks must not authorize inference.
        throw error;
      }
      const remainingMs = deadlineAt - now();
      if (remainingMs <= 0 || (freshnessSignal.aborted && freshnessBudgetMs <= FRESHNESS_TIMEOUT_MS)) {
        return JSON.stringify(stop('budget'));
      }
      if (freshnessSignal.aborted) throw new Error('review_workflow_freshness_timeout');
      if (!stillCurrent) return JSON.stringify(stop('stale'));
      const signal = AbortSignal.timeout(Math.min(PROVIDER_TIMEOUT_MS, remainingMs));
      let result: ReviewRouterOutcome;
      try {
        result = await ask(provider, signal);
      } catch {
        // Persist gateway failure; no Workflow-level inference retry.
        result = { kind: 'invalid', provider };
      }
      const budgetExpired = now() >= deadlineAt;
      // One gateway per step; unavailable/timeout is a local failure, not pool exhaustion.
      const failed: ReviewRouterOutcome = { kind: 'invalid', provider };
      const outcome = !budgetExpired && !signal.aborted &&
        result.kind === 'ok' && result.review.provider === provider ? result : failed;
      const checkpoint: Checkpoint = {
        attempt: { kind: 'attempt', outcome, aborted: budgetExpired },
        stopped: budgetExpired ? 'budget' : null,
      };
      const encoded = JSON.stringify(checkpoint);
      if (fitsStepOutput(encoded)) return encoded;
      return JSON.stringify({
        ...checkpoint,
        attempt: { kind: 'attempt', outcome: failed, aborted: budgetExpired },
      });
    });
    const checkpoint = JSON.parse(saved) as Checkpoint;
    state.stopped = checkpoint.stopped;
    return checkpoint.attempt;
  }, files, Math.min(providers.length, reviewSweepMaxAttempts('free')));
  return { sweep, stopped: state.stopped };
}

type DecisionResult = Awaited<ReturnType<typeof askDecisionJudge>>;
type JudgeCheckpoint = {
  stale: boolean;
  judged: JudgedFindings | null;
  marker: string | null;
};

// Existing judge contracts; separate durable checkpoints, no inference retry.
export async function checkpointReviewJudge(
  step: StepRunner,
  current: AbortableCallback<boolean>,
  decide: AbortableCallback<DecisionResult>,
  judge: AbortableCallback<JudgedFindings | null>,
): Promise<JudgeCheckpoint> {
  const run = async (
    name: string,
    config: typeof DECISION_STEP | typeof JUDGE_STEP,
    timeoutMs: number,
    operation: AbortableCallback<DecisionResult>,
  ): Promise<JudgeCheckpoint> => {
    const saved = await step.do(name, config, async () => {
      const freshnessSignal = AbortSignal.timeout(FRESHNESS_TIMEOUT_MS);
      const isCurrent = await current(freshnessSignal);
      if (freshnessSignal.aborted) throw new Error('review_workflow_freshness_timeout');
      if (!isCurrent) return JSON.stringify({ stale: true, judged: null, marker: null });
      const signal = AbortSignal.timeout(timeoutMs);
      let result: DecisionResult = { judged: null, marker: null };
      try {
        result = await operation(signal);
      } catch {
        // An unavailable judge must not discard verified L1 findings.
      }
      const checkpoint = { stale: false, ...result };
      const encoded = JSON.stringify(checkpoint);
      if (!signal.aborted && fitsStepOutput(encoded)) return encoded;
      return JSON.stringify({ stale: false, judged: null, marker: null });
    });
    return JSON.parse(saved) as JudgeCheckpoint;
  };
  const decision = await run('l2-decision', DECISION_STEP, 40_000, decide);
  if (decision.stale || decision.judged) return decision;
  const fallback = await run('l2-generative', JUDGE_STEP, 300_000, async (signal) => ({
    judged: await judge(signal),
    marker: decision.marker,
  }));
  return { ...fallback, marker: fallback.marker ?? decision.marker };
}

// Dry-run publication contract. Persist only diagnostic metadata, not another
// copy of the review body. Never call GitHub mutation endpoints here.
export function previewReviewPublication(
  target: ReviewTarget,
  sweep: ReviewSweepResult,
  l2: JudgeCheckpoint,
  status: ReturnType<typeof workflowStatus>,
) {
  if (status === 'stale') return { kind: 'skip', reason: 'stale_after_generation', findingCount: 0 } as const;
  if (status === 'budget' && !sweep.generated) return { kind: 'escalate', reason: 'paid_escalation_needed', findingCount: 0 } as const;
  const generated = sweep.generated;
  if (!generated) return { kind: 'escalate', reason: emptySweepSkip('free', sweep), findingCount: 0 } as const;
  if (sweep.disposition === 'invalid_findings') {
    return { kind: 'escalate', reason: 'paid_escalation_needed', findingCount: 0 } as const;
  }
  const publishable = findingsAfterJudge(sweep.findings, l2.judged);
  const plan = planReviewPublication(
    target, generated, publishable, false, l2.judged, l2.marker,
    Boolean(sweep.repeated) && !publishable.length,
  );
  if (plan.kind === 'comment') {
    return { kind: 'comment', reason: null, findingCount: plan.payload.comments.length } as const;
  }
  return {
    kind: plan.result.reviewed ? 'silent' : 'escalate',
    reason: plan.result.skipped ?? null,
    findingCount: plan.result.findingCount,
  } as const;
}

// Prototype fetch capability: read-only, except minting its installation token.
export function workflowReadOnlyFetch(target: ReviewTarget, fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const mint = method === 'POST' && url.origin === 'https://api.github.com' &&
      url.pathname === `/app/installations/${target.installationId}/access_tokens`;
    if (method !== 'GET' && method !== 'HEAD' && !mint) {
      throw new Error('review_workflow_read_only');
    }
    return fetcher(input, init);
  };
}

// Deployed binding probe. No repository access, inference or writes.
export async function runFreeReviewWorkflowSmoke(env: WebhookReviewEnv, step: StepRunner) {
  const order = await step.do('smoke-router', READ_STEP, async () =>
    workflowRouteOrder(await reviewProviderPoolHealthViaService(env)));
  const snapshot = await step.do('smoke-snapshot', READ_STEP, () => Promise.resolve(
    serializeReviewSnapshot({
      kind: 'ready', reviewInput: 'smoke', diffChars: 0, contextChars: 0,
      verifiableFiles: [{ path: 'smoke.ts', patch: '+x', rightLines: new Set([1]), sha: null }],
    })));
  const restored = restoreReviewSnapshot(snapshot);
  if (restored.kind !== 'ready' || !restored.verifiableFiles[0]?.rightLines.has(1)) {
    throw new Error('review_workflow_smoke_checkpoint_invalid');
  }
  return { mode: 'binding-smoke', status: 'completed', providerCount: order.length } as const;
}

// Prototype only: no webhook hook, no paid call, no GitHub mutation.
export async function runFreeReviewWorkflowPrototype(
  job: StoredJob,
  env: WebhookReviewEnv,
  step: StepRunner,
  fetcher: typeof fetch = runtimeFetch,
  authorize?: AbortableCallback<boolean>,
) {
  assertFreeReviewWorkflowJob(job, env);
  if (!env.KANAREK_REVIEW_ROUTER_TOKEN?.trim()) throw new Error('router_unconfigured');
  const readOnlyFetch = workflowReadOnlyFetch(job.target, fetcher);

  const snapshot = await step.do('prepare', READ_STEP, async () => {
    if (authorize && !await authorize(AbortSignal.timeout(FRESHNESS_TIMEOUT_MS))) {
      return serializeReviewSnapshot({ kind: 'finished', result: {
        reviewed: false, provider: null, findingCount: 0, skipped: 'managed_workflow_cancelled',
      } });
    }
    const client = await createInstallationClient(
      env.GITHUB_APP_ID, env.GITHUB_PRIVATE_KEY, job.target.installationId, readOnlyFetch,
    );
    return serializeReviewSnapshot(await prepareWebhookReview(job, env, client, readOnlyFetch));
  });
  const prepared = restoreReviewSnapshot(snapshot);
  if (prepared.kind === 'finished') {
    return { mode: 'prototype', status: 'skipped', reason: prepared.result.skipped ?? null } as const;
  }
  const route = JSON.parse(await step.do('route', READ_STEP, async () => {
    const health = await reviewProviderPoolHealthViaService(env);
    // Keep live order, even cooled gateways may recover before their turn.
    // Health's provider rows describe general, not necessarily review.
    const order = workflowRouteOrder(health);
    return JSON.stringify({ order, deadlineAt: Date.now() + FREE_BUDGET_MS });
  })) as { order: string[]; deadlineAt: number };
  const reviewEnv = reviewRouterEnvForAttempt({ ...env, KANAREK_REVIEW_WORKERS_AI_ENABLED: 'false' }, job.attempt);
  const current = async (signal: AbortSignal) => {
    if (!await reviewTargetIsCurrent(
      job.target, env, (input, init) => readOnlyFetch(input, { ...init, signal }),
    )) return false;
    return !authorize || await authorize(signal);
  };
  const { sweep: swept, stopped } = await checkpointFreeSweep(
    step, route.order, route.deadlineAt, prepared.verifiableFiles,
    current,
    (provider, signal) => askReviewRouter(
      prepared.reviewInput, reviewEnv, REVIEW_ROUTER_CODE_REVIEW_MODEL, [], signal, provider,
    ),
  );
  const sweep = withoutRepeatedFindings(swept, prepared.verifiableFiles, prepared.priorAnchors);
  let l2: JudgeCheckpoint = { stale: false, judged: null, marker: null };
  const generated = sweep.generated;
  if (!stopped && generated && sweep.disposition === 'publish' && sweep.findings.length) {
    const context = focusedReviewJudgeContext(prepared.reviewInput, sweep.findings);
    l2 = await checkpointReviewJudge(
      step, current,
      (signal) => askDecisionJudge(sweep.findings, generated.provider, generated.model, context, reviewEnv, signal),
      (signal) => askReviewJudge(sweep.findings, generated.provider, generated.model, context, reviewEnv, signal),
    );
  }
  const stillCurrent = await step.do('verify-head', READ_STEP, async () => {
    const signal = AbortSignal.timeout(FRESHNESS_TIMEOUT_MS);
    const result = await current(signal);
    if (signal.aborted) throw new Error('review_workflow_freshness_timeout');
    return result;
  });
  const status = workflowStatus(stopped, stillCurrent && !l2.stale);
  const publication = await step.do('publication-preview', READ_STEP, () =>
    Promise.resolve(previewReviewPublication(job.target, sweep, l2, status)));
  return {
    mode: 'prototype',
    status,
    publication,
    candidateDisposition: sweep.disposition,
    provider: sweep.generated?.provider ?? null,
    findingCount: publication.findingCount,
    l1FindingCount: sweep.findings.length,
    judgeProvider: l2.judged?.provider ?? null,
    judgeModel: l2.judged?.model ?? null,
    decisionMarker: l2.marker,
    attempts: sweep.attempts,
    excluded: sweep.excluded,
  } as const;
}
