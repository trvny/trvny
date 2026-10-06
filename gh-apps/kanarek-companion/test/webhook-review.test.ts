import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectNpmMajorBumps,
  fetchReviewDependencyEvidence,
  patchAddedRightLines,
  reviewFileCollectionComplete,
  reviewInputState,
  selectReviewFiles,
  type WebhookReviewEnv,
} from '../src/webhook-review-context.ts';
import {
  applyDecisionJudge,
  decisionL2FallbackMarker,
  decisionL2SuccessMarker,
  findingsAfterJudge,
  reviewAnchorLine,
  reviewMaxOutputTokens,
  reviewDecisionQuestions,
} from '../src/webhook-review-judge.ts';
import {
  nextReviewPhase,
  parseReviewJson,
  reviewOutputTokens,
  reviewContinuationJob,
  reviewMarker,
  reviewRetryDelayMs,
  reviewRouterEnvForAttempt,
  reviewSourceLabel,
  submittedReviewMatches,
  scheduleWebhookReviewWebhook,
  shouldRefreshSameTarget,
  shouldReplaceQueuedTarget,
  WebhookReviewJob,
  webhookReviewSettled,
} from '../src/webhook-review.ts';

const headA = 'a'.repeat(40);
const headB = 'b'.repeat(40);
const base = 'c'.repeat(40);
const baseB = 'd'.repeat(40);

function payload(
  headSha = headA,
  options: { action?: string; baseSha?: string; draft?: boolean; headRepository?: string } = {},
): Record<string, unknown> {
  return {
    action: options.action ?? 'synchronize',
    installation: { id: 123 },
    number: 21,
    repository: { full_name: 'travnie/llmbench' },
    pull_request: {
      draft: options.draft ?? false,
      base: { sha: options.baseSha ?? base },
      head: {
        sha: headSha,
        repo: {
          full_name: options.headRepository ?? 'travnie/llmbench',
        },
      },
    },
  };
}

function webhookRequest(body: Record<string, unknown>): Request {
  return new Request('https://kanarek.example/webhooks/github', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-delivery': 'delivery-1',
      'x-github-event': 'pull_request',
    },
    body: JSON.stringify(body),
  });
}

function fakeState(
  initial: Record<string, unknown> = {},
  initialAlarm: number | null = null,
): {
  alarms: number[];
  state: DurableObjectState;
  transactions: { count: number };
  values: Map<string, unknown>;
} {
  const values = new Map(Object.entries(initial));
  const alarms: number[] = [];
  const transactions = { count: 0 };
  let alarmAt = initialAlarm;
  const storage = {
    get(key: string) {
      return values.get(key);
    },
    put(
      keyOrEntries: string | Record<string, unknown>,
      value?: unknown,
    ) {
      if (typeof keyOrEntries === 'string') {
        values.set(keyOrEntries, value);
      } else {
        for (const [key, entry] of Object.entries(keyOrEntries)) {
          values.set(key, entry);
        }
      }
    },
    delete(keyOrKeys: string | string[]) {
      if (Array.isArray(keyOrKeys)) {
        let changed = false;
        for (const key of keyOrKeys) changed = values.delete(key) || changed;
        return changed;
      }
      return values.delete(keyOrKeys);
    },
    getAlarm() {
      return alarmAt;
    },
    setAlarm(at: number) {
      alarmAt = at;
      alarms.push(at);
    },
    transaction<T>(
      callback: (transaction: DurableObjectTransaction) => Promise<T>,
    ) {
      transactions.count += 1;
      return callback(storage as unknown as DurableObjectTransaction);
    },
  };
  return {
    alarms,
    transactions,
    values,
    state: { storage } as unknown as DurableObjectState,
  };
}

function queuedJob(
  headSha = headA,
  baseSha = base,
  options: {
    beforeSha?: string;
    delivery?: string;
    updatedAtMs?: number;
  } = {},
): Record<string, unknown> {
  return {
    body: JSON.stringify(payload(headSha, { baseSha })),
    target: {
      action: 'synchronize',
      baseSha,
      beforeSha: options.beforeSha,
      delivery: options.delivery ?? 'delivery-1',
      headSha,
      installationId: 123,
      number: 21,
      repository: 'travnie/llmbench',
      updatedAtMs: options.updatedAtMs,
    },
  };
}

test('review line anchors include only added RIGHT-side lines', () => {
  const patch = [
    '@@ -10,3 +10,4 @@',
    ' context',
    '-old',
    '+new',
    '+extra',
    ' tail',
  ].join('\n');
  assert.deepEqual([...patchAddedRightLines(patch)], [11, 12]);
});

test('review anchors tolerate nearby context lines', () => {
  const rightLines = new Set([11, 12]);
  assert.equal(reviewAnchorLine(rightLines, 11), 11);
  assert.equal(reviewAnchorLine(rightLines, 10), 11);
  assert.equal(reviewAnchorLine(rightLines, 15), 12);
  assert.equal(reviewAnchorLine(rightLines, 16), null);
});

test('dependency evidence detection keeps only npm semver-major bumps', () => {
  const bumps = detectNpmMajorBumps([
    {
      path: 'worker/package.json',
      patch: [
        '@@ -16,7 +16,7 @@',
        '   "dependencies": {',
        '-    "feedsmith": "^2.9.6",',
        '+    "feedsmith": "^3.0.0",',
        '-    "tiny": "~1.2.3"',
        '+    "tiny": "~1.3.0"',
        '   }',
      ].join('\n'),
    },
    {
      path: 'worker/package-lock.json',
      patch: '- "other": "1.0.0"\n+ "other": "2.0.0"',
    },
  ]);

  assert.deepEqual(bumps, [
    { package: 'feedsmith', fromVersion: '2.9.6', toVersion: '3.0.0' },
  ]);
});

test('dependency evidence verifies the exact npm target and captures matching upstream release notes', async () => {
  const calls: string[] = [];
  const fetcher = ((input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    calls.push(url);
    if (url === 'https://registry.npmjs.org/feedsmith/3.0.0') {
      return Promise.resolve(Response.json({
        name: 'feedsmith',
        version: '3.0.0',
        repository: { url: 'git+https://github.com/macieklamberski/feedsmith.git' },
        dist: { integrity: 'sha512-demo' },
      }));
    }
    if (url === 'https://registry.npmjs.org/feedsmith/latest') {
      return Promise.resolve(Response.json({
        name: 'feedsmith',
        version: '3.0.0',
      }));
    }
    if (url.startsWith('https://registry.npmjs.org/-/v1/search')) {
      return Promise.resolve(Response.json({
        objects: [{ package: { name: 'feedsmith', version: '3.0.0' } }],
      }));
    }
    if (url.endsWith('/releases/tags/v3.0.0')) {
      return Promise.resolve(Response.json({
        tag_name: 'v3.0.0',
        name: 'Feedsmith 3.0',
        html_url: 'https://github.com/macieklamberski/feedsmith/releases/tag/v3.0.0',
        body: 'Breaking: Atom text fields now use text constructs. RSS person fields are structured objects.',
      }));
    }
    throw new Error(`unexpected URL ${url}`);
  }) as typeof fetch;

  const evidence = await fetchReviewDependencyEvidence(
    [{
      path: 'worker/package.json',
      patch: '-    "feedsmith": "^2.9.6"\n+    "feedsmith": "^3.0.0"',
    }],
    fetcher,
  );

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.verified, true);
  assert.equal(evidence[0]?.repository, 'macieklamberski/feedsmith');
  assert.match(evidence[0]?.release?.bodyExcerpt ?? '', /Atom text fields/);
  assert.ok(calls.some((url) => url.endsWith('/releases/tags/v3.0.0')));
});

test('review input does not mark missing GitHub patches as empty code', () => {
  assert.equal(
    reviewInputState([{ filename: 'src/large.ts' }], 0),
    'patch_unavailable',
  );
  assert.equal(
    reviewInputState(
      [
        { filename: 'src/available.ts', patch: '@@ -0,0 +1 @@\n+ok' },
        { filename: 'src/missing.ts' },
      ],
      1,
    ),
    'patch_unavailable',
  );
  assert.equal(
    reviewInputState([{ filename: 'README.md' }], 0),
    'no_code_diff',
  );
  assert.equal(
    reviewInputState([{ filename: 'src/large.ts', patch: '@@ -0,0 +1 @@\\n+ok' }], 1),
    'reviewable',
  );
});

test('expanded paid diff profile can retain more of one large patch', () => {
  const patch = '@@ -1 +1 @@\n+' + 'x'.repeat(40_000);
  const compact = selectReviewFiles(
    [{ filename: 'src/large.ts', patch, sha: 'a'.repeat(40) }],
    60_000,
  );
  const expanded = selectReviewFiles(
    [{ filename: 'src/large.ts', patch, sha: 'a'.repeat(40) }],
    250_000,
    48_000,
  );

  assert.equal(compact[0]?.patch.length, 14_000);
  assert.equal(expanded[0]?.patch.length, patch.length);
});

test('review file collection stops once the diff budget is full', () => {
  const patch = `@@ -0,0 +1 @@\n+${'x'.repeat(4_990)}`;
  const files = Array.from({ length: 2 }, (_, index) => ({
    filename: `src/file-${index}.ts`,
    patch,
  }));
  assert.equal(reviewFileCollectionComplete(files, 5_000), true);
});

test('review paid escalation uses a fresh phase instead of retry backoff', () => {
  const escalation = {
    findingCount: 0,
    provider: 'vercel',
    reviewed: false,
    skipped: 'paid_escalation_needed',
  };
  assert.equal(nextReviewPhase(escalation, 'free'), 'paid');
  assert.equal(nextReviewPhase(escalation, 'paid'), null);
  assert.equal(reviewRetryDelayMs(escalation, 0), null);
});

test('review retries are bounded and only cover transient failures', () => {
  const transient = {
    findingCount: 0,
    provider: null,
    reviewed: false,
    skipped: 'providers_failed',
  };
  assert.equal(reviewRetryDelayMs(transient, 0), 2 * 60_000);
  assert.equal(reviewRetryDelayMs(transient, 1), 10 * 60_000);
  assert.equal(reviewRetryDelayMs(transient, 2), 30 * 60_000);
  assert.equal(reviewRetryDelayMs(transient, 3), null);
  assert.equal(
    reviewRetryDelayMs({ ...transient, skipped: 'job_failed' }, 0),
    2 * 60_000,
  );
  // A billed completion that failed verification is not retried.
  assert.equal(
    reviewRetryDelayMs({ ...transient, skipped: 'invalid_findings' }, 0),
    null,
  );
  assert.equal(
    reviewRetryDelayMs({ ...transient, skipped: 'no_code_diff' }, 0),
    null,
  );
});


test('review retries spend Workers AI at most once per head', () => {
  const env = {
    KANAREK_REVIEW_WORKERS_AI_ENABLED: 'true',
  } as WebhookReviewEnv;

  assert.equal(reviewRouterEnvForAttempt(env, undefined), env);
  assert.equal(reviewRouterEnvForAttempt(env, 0), env);

  const retry = reviewRouterEnvForAttempt(env, 1);
  assert.notEqual(retry, env);
  assert.equal(retry.KANAREK_REVIEW_WORKERS_AI_ENABLED, 'false');
  assert.equal(env.KANAREK_REVIEW_WORKERS_AI_ENABLED, 'true');
  assert.equal(
    reviewRouterEnvForAttempt(retry, 3).KANAREK_REVIEW_WORKERS_AI_ENABLED,
    'false',
  );
});

test('deletion-only code patches stay reviewable without inline anchors', () => {
  const files = selectReviewFiles(
    [
      {
        filename: 'src/deleted.ts',
        patch: '@@ -10,2 +10,0 @@\n-old call\n-old guard',
      },
    ],
    5_000,
  );
  assert.equal(files.length, 1);
  assert.equal(files[0]?.rightLines.size, 0);
  assert.equal(reviewInputState([{ filename: 'src/deleted.ts', patch: files[0]?.patch }], files.length), 'reviewable');
});

test('review submission marker is target-specific and bot-authenticated', () => {
  const target = {
    action: 'synchronize',
    baseSha: base,
    delivery: 'delivery-1',
    headSha: headA,
    installationId: 123,
    number: 21,
    repository: 'travnie/llmbench',
  };
  const marker = reviewMarker(target);
  assert.match(marker, /kanarek-review:/);
  assert.equal(
    submittedReviewMatches(
      {
        body: `${marker}\nreview`,
        commit_id: headA,
        user: { login: 'kanarek-companion[bot]' },
      },
      target,
    ),
    true,
  );
  assert.equal(
    submittedReviewMatches(
      {
        body: `${marker}\nspoofed`,
        commit_id: headA,
        user: { login: 'someone' },
      },
      target,
    ),
    false,
  );
  const movedBaseTarget = { ...target, baseSha: headB };
  assert.equal(
    submittedReviewMatches(
      {
        body: `${marker}\nprovider summary mentions ${reviewMarker(movedBaseTarget)}`,
        commit_id: headA,
        user: { login: 'kanarek-companion[bot]' },
      },
      movedBaseTarget,
    ),
    false,
  );
});

test('review JSON parser accepts fenced provider output', () => {
  const parsed = parseReviewJson(
    '```json\n{"summary":"🐤 没发现问题","findings":[]}\n```',
  );
  assert.equal(parsed?.summary, '🐤 没发现问题');
  assert.deepEqual(parsed?.findings, []);
});

test('review JSON parser rejects non-object and incomplete output', () => {
  assert.equal(parseReviewJson('[]'), null);
  assert.equal(parseReviewJson('123'), null);
  assert.equal(parseReviewJson('{"summary":"没问题"}'), null);
  assert.equal(parseReviewJson('{"findings":[]}'), null);
});

test('webhook review scheduler ignores drafts and external forks', async () => {
  let calls = 0;
  const env = {
    KANAREK_REVIEW_JOBS: {
      idFromName(name: string) {
        return name as unknown as DurableObjectId;
      },
      get() {
        return {
          fetch() {
            calls += 1;
            return Promise.resolve(Response.json({ ok: true }));
          },
        } as DurableObjectStub;
      },
    } as unknown as DurableObjectNamespace,
  } as WebhookReviewEnv;

  const tasks: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(task: Promise<unknown>) {
      tasks.push(task);
    },
  } as unknown as ExecutionContext;

  scheduleWebhookReviewWebhook(
    webhookRequest(payload(headA, { draft: true })),
    env,
    ctx,
  );
  scheduleWebhookReviewWebhook(
    webhookRequest(
      payload(headA, { headRepository: 'someone/forked-llmbench' }),
    ),
    env,
    ctx,
  );
  await Promise.all(tasks);
  assert.equal(calls, 0);
});

test('webhook review job debounces to the newest head', async () => {
  const { alarms, state, values } = fakeState();
  const job = new WebhookReviewJob(state, {
    KANAREK_WEBHOOK_REVIEW_DEBOUNCE_MS: '60000',
  } as WebhookReviewEnv);

  const before = Date.now();
  const first = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(queuedJob(headA)),
    }),
  );
  const second = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(queuedJob(headB)),
    }),
  );

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(alarms.length, 2);
  assert.ok(alarms[1] >= before + 59_000);
  const stored = values.get('job') as {
    phase?: string;
    target?: { headSha?: string };
  };
  assert.equal(stored.target?.headSha, headB);
  assert.equal(stored.phase, 'free');
});

test('same review target is never considered a replacement target', () => {
  const existing = (queuedJob(headA, base) as {
    target: Parameters<typeof shouldReplaceQueuedTarget>[0];
  }).target;
  const incoming = (queuedJob(headA, base) as {
    target: Parameters<typeof shouldReplaceQueuedTarget>[1];
  }).target;
  assert.equal(shouldReplaceQueuedTarget(existing, incoming), false);
});

test('equal-timestamp ordering helpers recognize both transition directions', () => {
  const earlyA = (queuedJob(headA, base, {
    beforeSha: 'e'.repeat(40),
    delivery: 'delivery-a1',
    updatedAtMs: 2_000,
  }) as { target: Parameters<typeof shouldRefreshSameTarget>[0] }).target;
  const returnedA = (queuedJob(headA, base, {
    beforeSha: headB,
    delivery: 'delivery-a2',
    updatedAtMs: 2_000,
  }) as { target: Parameters<typeof shouldRefreshSameTarget>[1] }).target;
  const lateB = (queuedJob(headB, base, {
    beforeSha: headA,
    delivery: 'delivery-b',
    updatedAtMs: 2_000,
  }) as { target: Parameters<typeof shouldReplaceQueuedTarget>[1] }).target;

  assert.equal(shouldRefreshSameTarget(earlyA, returnedA), true);
  assert.equal(shouldReplaceQueuedTarget(returnedA, lateB), true);
  assert.equal(shouldReplaceQueuedTarget(lateB, returnedA), true);
});

test('same-target redelivery preserves an active paid escalation phase atomically', async () => {
  const paidJob = {
    ...queuedJob(headA, base, {
      beforeSha: 'e'.repeat(40),
      delivery: 'delivery-a1',
      updatedAtMs: 1_000,
    }),
    attempt: 0,
    phase: 'paid',
  };
  const { alarms, state, transactions, values } = fakeState({
    job: paidJob,
    status: 'escalating',
  }, Date.now() + 1_000);
  const job = new WebhookReviewJob(state, {
    KANAREK_WEBHOOK_REVIEW_DEBOUNCE_MS: '60000',
  } as WebhookReviewEnv);

  const response = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(
        queuedJob(headA, base, {
          beforeSha: headB,
          delivery: 'delivery-a2',
          updatedAtMs: 2_000,
        }),
      ),
    }),
  );
  const body = (await response.json()) as {
    duplicate?: boolean;
    queued?: boolean;
  };
  const stored = values.get('job') as {
    attempt?: number;
    phase?: string;
    target?: {
      beforeSha?: string;
      delivery?: string;
      updatedAtMs?: number;
    };
  };

  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(body.queued, true);
  assert.equal(transactions.count, 1);
  assert.equal(stored.phase, 'paid');
  assert.equal(stored.attempt, 0);
  assert.equal(stored.target?.beforeSha, headB);
  assert.equal(stored.target?.delivery, 'delivery-a2');
  assert.equal(stored.target?.updatedAtMs, 2_000);
  assert.equal(values.get('status'), 'escalating');
  assert.equal(alarms.length, 0);
});

test('same-target redelivery preserves retry backoff instead of restarting free review', async () => {
  const retryingJob = {
    ...queuedJob(headA, base),
    attempt: 2,
    phase: 'paid',
  };
  const { alarms, state, values } = fakeState({
    job: retryingJob,
    status: 'retrying',
  }, Date.now() + 120_000);
  const job = new WebhookReviewJob(state, {} as WebhookReviewEnv);

  const response = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(queuedJob(headA, base)),
    }),
  );
  const stored = values.get('job') as { attempt?: number; phase?: string };

  assert.equal(response.status, 200);
  assert.equal(stored.phase, 'paid');
  assert.equal(stored.attempt, 2);
  assert.equal(values.get('status'), 'retrying');
  assert.equal(alarms.length, 0);
});

test('equal-timestamp return transition survives a late predecessor enqueue', async () => {
  const currentA = {
    ...queuedJob(headA, base, {
      beforeSha: 'e'.repeat(40),
      delivery: 'delivery-a1',
      updatedAtMs: 2_000,
    }),
    attempt: 1,
    phase: 'paid',
  };
  const { alarms, state, values } = fakeState({
    job: currentA,
    status: 'retrying',
  }, Date.now() + 120_000);
  const job = new WebhookReviewJob(state, {} as WebhookReviewEnv);

  await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(
        queuedJob(headA, base, {
          beforeSha: headB,
          delivery: 'delivery-a2',
          updatedAtMs: 2_000,
        }),
      ),
    }),
  );
  const late = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(
        queuedJob(headB, base, {
          beforeSha: headA,
          delivery: 'delivery-b',
          updatedAtMs: 2_000,
        }),
      ),
    }),
  );
  const lateBody = (await late.json()) as {
    stale?: boolean;
    queued?: boolean;
  };
  const stored = values.get('job') as {
    attempt?: number;
    phase?: string;
    target?: { beforeSha?: string; headSha?: string };
  };

  assert.equal(lateBody.stale, true);
  assert.equal(lateBody.queued, false);
  assert.equal(stored.phase, 'paid');
  assert.equal(stored.attempt, 1);
  assert.equal(stored.target?.headSha, headA);
  assert.equal(stored.target?.beforeSha, headB);
  assert.equal(alarms.length, 0);
});

test('equal-timestamp B to A return replaces B and guards against a late B replay', async () => {
  const currentB = {
    ...queuedJob(headB, base, {
      beforeSha: headA,
      delivery: 'delivery-b1',
      updatedAtMs: 2_000,
    }),
    attempt: 0,
    phase: 'free',
  };
  const { state, values } = fakeState({
    job: currentB,
    status: 'queued',
  }, Date.now() + 120_000);
  const job = new WebhookReviewJob(state, {} as WebhookReviewEnv);

  const returned = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(
        queuedJob(headA, base, {
          beforeSha: headB,
          delivery: 'delivery-a2',
          updatedAtMs: 2_000,
        }),
      ),
    }),
  );
  const returnedBody = (await returned.json()) as {
    duplicate?: boolean;
    queued?: boolean;
  };
  const afterReturn = values.get('job') as {
    target?: { headSha?: string };
    tieBreakPredecessorSha?: string;
  };

  assert.equal(returnedBody.duplicate, false);
  assert.equal(returnedBody.queued, true);
  assert.equal(afterReturn.target?.headSha, headA);
  assert.equal(afterReturn.tieBreakPredecessorSha, headB);

  const lateB = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(
        queuedJob(headB, base, {
          beforeSha: headA,
          delivery: 'delivery-b1',
          updatedAtMs: 2_000,
        }),
      ),
    }),
  );
  const lateBody = (await lateB.json()) as {
    stale?: boolean;
    queued?: boolean;
  };
  const final = values.get('job') as {
    target?: { headSha?: string };
    tieBreakPredecessorSha?: string;
  };

  assert.equal(lateBody.stale, true);
  assert.equal(lateBody.queued, false);
  assert.equal(final.target?.headSha, headA);
  assert.equal(final.tieBreakPredecessorSha, headB);
});

test('continuation keeps refreshed same-target metadata after a running attempt', () => {
  const started = {
    ...queuedJob(headA, base, {
      beforeSha: 'e'.repeat(40),
      updatedAtMs: 1_000,
    }),
    attempt: 0,
    phase: 'free' as const,
  };
  const refreshed = {
    ...started,
    body: JSON.stringify({ refreshed: true }),
    target: {
      ...(started.target as Record<string, unknown>),
      beforeSha: headB,
      updatedAtMs: 2_000,
    },
  };

  const continuation = reviewContinuationJob(
    started as Parameters<typeof reviewContinuationJob>[0],
    refreshed as Parameters<typeof reviewContinuationJob>[1],
  );
  assert.equal(continuation.body, refreshed.body);
  assert.equal(continuation.target.beforeSha, headB);
  assert.equal(continuation.target.updatedAtMs, 2_000);
  assert.equal(continuation.phase, 'free');
  assert.equal(continuation.attempt, 0);
});

test('same-target redelivery re-arms a missing alarm without resetting phase', async () => {
  const paidJob = {
    ...queuedJob(headA, base),
    attempt: 1,
    phase: 'paid',
  };
  const { alarms, state, values } = fakeState({
    job: paidJob,
    status: 'retrying',
  });
  const job = new WebhookReviewJob(state, {} as WebhookReviewEnv);

  const before = Date.now();
  await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(queuedJob(headA, base)),
    }),
  );

  const stored = values.get('job') as { attempt?: number; phase?: string };
  assert.equal(stored.phase, 'paid');
  assert.equal(stored.attempt, 1);
  assert.equal(values.get('status'), 'retrying');
  assert.equal(alarms.length, 1);
  assert.ok(alarms[0] >= before + 900 && alarms[0] <= Date.now() + 1_100);
});

test('webhook review job preserves a newer queued target from stale redelivery', async () => {
  const newer = queuedJob(headB, base, {
    beforeSha: headA,
    updatedAtMs: 2_000,
  });
  const { alarms, state, values } = fakeState({ job: newer, status: 'queued' });
  const job = new WebhookReviewJob(state, {} as WebhookReviewEnv);
  const response = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(
        queuedJob(headA, base, {
          beforeSha: 'e'.repeat(40),
          updatedAtMs: 1_000,
        }),
      ),
    }),
  );
  const responseBody = (await response.json()) as {
    queued?: boolean;
    stale?: boolean;
  };
  const stored = values.get('job') as { target?: { headSha?: string } };

  assert.equal(responseBody.stale, true);
  assert.equal(responseBody.queued, false);
  assert.equal(stored.target?.headSha, headB);
  assert.equal(alarms.length, 0);
});

test('webhook review job deduplicates only the same head and base', async () => {
  const completedTarget = `${headA}:${base}`;
  const { alarms, state } = fakeState({ 'completed-target': completedTarget });
  const job = new WebhookReviewJob(state, {} as WebhookReviewEnv);
  const duplicateResponse = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(queuedJob(headA, base)),
    }),
  );
  const duplicateBody = (await duplicateResponse.json()) as {
    duplicate?: boolean;
    queued?: boolean;
  };

  assert.equal(duplicateBody.duplicate, true);
  assert.equal(duplicateBody.queued, false);
  assert.equal(alarms.length, 0);

  const rebasedResponse = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(queuedJob(headA, baseB)),
    }),
  );
  const rebasedBody = (await rebasedResponse.json()) as {
    duplicate?: boolean;
    queued?: boolean;
  };
  assert.equal(rebasedBody.duplicate, false);
  assert.equal(rebasedBody.queued, true);
  assert.equal(alarms.length, 1);
});

test('free and paid review output budgets stay independent', () => {
  const env = {
    KANAREK_WEBHOOK_REVIEW_MAX_OUTPUT_TOKENS: '36864',
    KANAREK_WEBHOOK_REVIEW_PAID_MAX_OUTPUT_TOKENS: '16384',
  };
  assert.equal(reviewOutputTokens(env, 'kanarek-review-free'), 36_864);
  assert.equal(reviewOutputTokens(env, 'kanarek-review-paid'), 16_384);
  assert.equal(reviewOutputTokens({}, 'kanarek-review-paid'), 36_864);
  assert.equal(reviewOutputTokens({}, 'kanarek-review-free'), 36_864);
});

test('PR review output headroom defaults to 36k and allows provider-sized ceilings', () => {
  assert.equal(reviewMaxOutputTokens(undefined), 36_864);
  assert.equal(reviewMaxOutputTokens('32768'), 32_768);
  assert.equal(reviewMaxOutputTokens('65536'), 65_536);
  assert.equal(reviewMaxOutputTokens('65537'), 36_864);
  assert.equal(reviewMaxOutputTokens('wat'), 36_864);
});

function fakeNamespace(fetcher: (request: Request) => Promise<Response>): DurableObjectNamespace {
  return {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetcher(input instanceof Request ? input : new Request(input, init)),
    }),
  } as unknown as DurableObjectNamespace;
}

test('review status gates branch updates only while this head is in flight', async () => {
  const { state } = fakeState();
  const job = new WebhookReviewJob(state, {} as WebhookReviewEnv);
  const env = { KANAREK_REVIEW_JOBS: fakeNamespace((request) => job.fetch(request)) };

  assert.equal(await webhookReviewSettled(env, 'travnie/llmbench', 21, headA), true);
  await job.fetch(new Request('https://kanarek-review.internal/enqueue', {
    method: 'POST',
    body: JSON.stringify(queuedJob(headA, base)),
  }));
  assert.equal(await webhookReviewSettled(env, 'travnie/llmbench', 21, headA), false);
  assert.equal(await webhookReviewSettled(env, 'travnie/llmbench', 21, headA.toUpperCase()), false);
  assert.equal(await webhookReviewSettled(env, 'travnie/llmbench', 21, headB), true);

  const upper = fakeState();
  const upperJob = new WebhookReviewJob(upper.state, {} as WebhookReviewEnv);
  const upperEnv = { KANAREK_REVIEW_JOBS: fakeNamespace((request) => upperJob.fetch(request)) };
  await upperJob.fetch(new Request('https://kanarek-review.internal/enqueue', {
    method: 'POST',
    body: JSON.stringify(queuedJob(headA.toUpperCase(), base)),
  }));
  assert.equal(await webhookReviewSettled(upperEnv, 'travnie/llmbench', 21, headA), false);

  const failing = { KANAREK_REVIEW_JOBS: fakeNamespace(() => Promise.reject(new Error('down'))) };
  assert.equal(await webhookReviewSettled(failing, 'travnie/llmbench', 21, headA), false);
  assert.equal(
    await webhookReviewSettled(
      { ...failing, KANAREK_WEBHOOK_REVIEW_ENABLED: 'false' },
      'travnie/llmbench',
      21,
      headA,
    ),
    true,
  );
});

test('finished review job asks the companion to re-evaluate the PR', async () => {
  const { state, values } = fakeState({ job: { ...queuedJob(headA, base), attempt: 0, phase: 'free' } });
  const refreshes: Record<string, unknown>[] = [];
  const job = new WebhookReviewJob(state, {
    COMPANION_LOCK: fakeNamespace(async (request) => {
      refreshes.push(await request.json() as Record<string, unknown>);
      return Response.json({ ok: true, queued: true });
    }),
  } as unknown as WebhookReviewEnv);

  await job.alarm();

  assert.equal(values.has('job'), false);
  assert.equal(refreshes.length, 1);
  assert.equal(refreshes[0]?.sourceEvent, 'review_job');
  assert.equal(refreshes[0]?.pullRequestNumber, 21);
  assert.equal(refreshes[0]?.repository, 'travnie/llmbench');
  assert.equal(refreshes[0]?.installationId, 123);
});


test('decision L2 stays within the recommended sixteen-question fanout', () => {
  const findings = Array.from({ length: 8 }, (_value, index) => ({
    body: `body ${index}`,
    existingCode: `const value${index} = true;`,
    line: index + 1,
    path: 'src/example.ts',
    severity: 'medium' as const,
    title: `finding ${index}`,
  }));

  const questions = reviewDecisionQuestions(findings);
  assert.equal(Object.keys(questions).length, 15);
  assert.equal((questions.keep_0 as { type?: string }).type, 'noul');
  assert.equal((questions.duplicate_7 as { type?: string }).type, 'choice');
});

test('decision L2 collapses only high-confidence duplicates and picks the stronger representative', () => {
  const findings = [
    {
      body: 'first wording',
      existingCode: 'return stale;',
      line: 10,
      path: 'src/example.ts',
      severity: 'medium' as const,
      title: 'stale result',
    },
    {
      body: 'same root cause with better evidence',
      existingCode: 'return stale;',
      line: 12,
      path: 'src/example.ts',
      severity: 'medium' as const,
      title: 'same stale result',
    },
  ];

  const judged = applyDecisionJudge(findings, {
    model: 'decision-model-preview',
    answers: {
      keep_0: { type: 'noul', noul: 0.91 },
      keep_1: { type: 'noul', noul: 0.99 },
      duplicate_1: {
        type: 'choice',
        choice: 'finding_0',
        confidence: 0.97,
        probabilities: { finding_0: 0.98, none: 0.02 },
      },
    },
    usage: { input_tokens: 42 },
    latency_ms: 17,
  }, 0.9);

  assert.ok(judged);
  assert.deepEqual(judged.findings, [findings[1]]);
  assert.deepEqual(judged.telemetry.keepProbabilities, [0.91, 0.99]);
  assert.equal(judged.telemetry.duplicates[0]?.target, 0);
});

test('decision L2 fails open for uncertain duplicates and low keep probability', () => {
  const findings = [
    {
      body: 'first',
      existingCode: 'const x = 1;',
      line: 1,
      path: 'src/example.ts',
      severity: 'low' as const,
      title: 'first',
    },
    {
      body: 'second',
      existingCode: 'const y = 2;',
      line: 2,
      path: 'src/example.ts',
      severity: 'low' as const,
      title: 'second',
    },
  ];

  const judged = applyDecisionJudge(findings, {
    model: 'decision-model-preview',
    answers: {
      keep_0: { type: 'noul', noul: 0.01 },
      keep_1: { type: 'noul', noul: 0.88 },
      duplicate_1: {
        type: 'choice',
        choice: 'finding_0',
        confidence: 0.7,
        probabilities: { finding_0: 0.72, none: 0.28 },
      },
    },
  }, 0.9);

  assert.ok(judged);
  assert.deepEqual(judged.findings, findings);
});


test('judge failure preserves reviewer findings for publication', () => {
  const findings = [{
    body: 'real reviewer finding',
    existingCode: 'return broken;',
    line: 7,
    path: 'src/example.ts',
    severity: 'high' as const,
    title: 'broken behavior',
  }];
  assert.equal(findingsAfterJudge(findings, null), findings);
  assert.deepEqual(
    findingsAfterJudge(findings, { findings: [] }),
    [],
  );
});

test('decision L2 diagnostics are safe hidden markers', () => {
  assert.equal(
    decisionL2FallbackMarker('Provider HTTP 400 / Invalid Questions'),
    '<!-- kanarek-decision-l2:fallback:provider_http_400_invalid_questions -->',
  );
  assert.equal(
    decisionL2SuccessMarker({
      duplicates: [],
      keepProbabilities: [0.987654, 0.123456],
      latencyMs: 52.6,
      requestId: 'not-published',
      inputTokens: 321,
    }),
    '<!-- kanarek-decision-l2:ok:keep=0.9877,0.1235:latency_ms=53:input_tokens=321 -->',
  );
});


test('decision providers render distinct L2 attribution labels', () => {
  assert.equal(
    reviewSourceLabel('openrouter-decision', 'inception/mercury-decide:free'),
    'OpenRouter Decisions · `inception/mercury-decide:free`',
  );
  assert.equal(
    reviewSourceLabel('qwencloud-decision', 'decision-model-preview'),
    'QwenCloud Decision · `decision-model-preview`',
  );
  assert.equal(
    reviewSourceLabel('vercel-decision', 'convaiinnovations/laya-free'),
    'Vercel AI Gateway Decision · `convaiinnovations/laya-free`',
  );
});
