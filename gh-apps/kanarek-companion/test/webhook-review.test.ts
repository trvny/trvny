import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectNpmMajorBumps,
  fetchReviewDependencyEvidence,
  nextReviewPhase,
  parseReviewJson,
  patchAddedRightLines,
  reviewAnchorLine,
  reviewFileCollectionComplete,
  reviewInputState,
  reviewMaxOutputTokens,
  reviewOutputTokens,
  reviewContinuationJob,
  reviewMarker,
  reviewRetryDelayMs,
  reviewRouterEnvForAttempt,
  selectReviewFiles,
  submittedReviewMatches,
  scheduleWebhookReviewWebhook,
  shouldReplaceQueuedJob,
  shouldReplaceQueuedTarget,
  WebhookReviewJob,
  type WebhookReviewEnv,
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
  transactions: number[];
  values: Map<string, unknown>;
} {
  const values = new Map(Object.entries(initial));
  const alarms: number[] = [];
  const transactions: number[] = [];
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
      callback: (txn: DurableObjectTransaction) => Promise<T>,
    ): Promise<T> {
      transactions.push(1);
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
  options: { beforeSha?: string; updatedAtMs?: number } = {},
): Record<string, unknown> {
  return {
    body: JSON.stringify(payload(headSha, { baseSha })),
    target: {
      action: 'synchronize',
      baseSha,
      beforeSha: options.beforeSha,
      delivery: 'delivery-1',
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
    reviewRetryDelayMs({ ...transient, skipped: 'invalid_findings' }, 0),
    2 * 60_000,
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

test('same-target redelivery preserves paid phase and retry backoff', async () => {
  const paidJob = {
    ...queuedJob(headA, base),
    attempt: 2,
    phase: 'paid' as const,
  };
  const { alarms, state, transactions, values } = fakeState(
    { job: paidJob, status: 'retrying' },
    Date.now() + 120_000,
  );
  const job = new WebhookReviewJob(state, {} as WebhookReviewEnv);

  const response = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(queuedJob(headA, base)),
    }),
  );
  const stored = values.get('job') as {
    attempt?: number;
    phase?: string;
  };

  assert.equal(response.status, 200);
  assert.equal(stored.phase, 'paid');
  assert.equal(stored.attempt, 2);
  assert.equal(values.get('status'), 'retrying');
  assert.equal(alarms.length, 0);
  assert.equal(transactions.length, 1);
});

test('same-target redelivery re-arms a missing alarm without resetting paid state', async () => {
  const paidJob = {
    ...queuedJob(headA, base),
    attempt: 1,
    phase: 'paid' as const,
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

test('equal-timestamp A-B-A return verifies current PR and rejects delayed B', async () => {
  const queuedB = {
    ...queuedJob(headB, base, {
      beforeSha: headA,
      updatedAtMs: 1_000,
    }),
    phase: 'free' as const,
    supersededHeadShas: [headA],
  };
  const { alarms, state, values } = fakeState(
    { job: queuedB, status: 'queued' },
    Date.now() + 120_000,
  );
  const verifiedHeads: string[] = [];
  const job = new WebhookReviewJob(
    state,
    {} as WebhookReviewEnv,
    async (target) => {
      verifiedHeads.push(target.headSha);
      return target.headSha === headA;
    },
  );

  const returned = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(
        queuedJob(headA, base, {
          beforeSha: headB,
          updatedAtMs: 1_000,
        }),
      ),
    }),
  );
  const returnedBody = (await returned.json()) as {
    queued?: boolean;
    stale?: boolean;
  };
  let stored = values.get('job') as {
    supersededHeadShas?: string[];
    target?: { headSha?: string; beforeSha?: string };
  };
  assert.equal(returnedBody.queued, true);
  assert.equal(returnedBody.stale, undefined);
  assert.equal(stored.target?.headSha, headA);
  assert.equal(stored.target?.beforeSha, headB);
  assert.ok(stored.supersededHeadShas?.includes(headB));

  const delayed = await job.fetch(
    new Request('https://kanarek-review.internal/enqueue', {
      method: 'POST',
      body: JSON.stringify(
        queuedJob(headB, base, {
          beforeSha: headA,
          updatedAtMs: 1_000,
        }),
      ),
    }),
  );
  const delayedBody = (await delayed.json()) as {
    queued?: boolean;
    stale?: boolean;
  };
  stored = values.get('job') as {
    supersededHeadShas?: string[];
    target?: { headSha?: string; beforeSha?: string };
  };
  assert.equal(delayedBody.stale, true);
  assert.equal(delayedBody.queued, false);
  assert.equal(stored.target?.headSha, headA);
  assert.deepEqual(verifiedHeads, [headA, headB]);
  assert.equal(alarms.length, 1);
});

test('newer replacement accepts a later head despite previous history', () => {
  const existing = {
    ...queuedJob(headA, base, {
      beforeSha: 'e'.repeat(40),
      updatedAtMs: 1_000,
    }),
    supersededHeadShas: [headB],
  };
  const incoming = queuedJob(headB, base, {
    beforeSha: headA,
    updatedAtMs: 2_000,
  });
  assert.equal(
    shouldReplaceQueuedJob(
      existing as Parameters<typeof shouldReplaceQueuedJob>[0],
      incoming as Parameters<typeof shouldReplaceQueuedJob>[1],
    ),
    true,
  );
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
    supersededHeadShas: [headB],
    target: {
      ...(started as { target: Record<string, unknown> }).target,
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
  assert.deepEqual(continuation.supersededHeadShas, [headB]);
  assert.equal(continuation.phase, 'free');
  assert.equal(continuation.attempt, 0);
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
});

test('PR review output headroom defaults to 36k and allows provider-sized ceilings', () => {
  assert.equal(reviewMaxOutputTokens(undefined), 36_864);
  assert.equal(reviewMaxOutputTokens('32768'), 32_768);
  assert.equal(reviewMaxOutputTokens('65536'), 65_536);
  assert.equal(reviewMaxOutputTokens('65537'), 36_864);
  assert.equal(reviewMaxOutputTokens('wat'), 36_864);
});
