import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseReviewJson,
  patchAddedRightLines,
  reviewFileCollectionComplete,
  reviewInputState,
  reviewMarker,
  selectReviewFiles,
  submittedReviewMatches,
  scheduleWebhookReviewWebhook,
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
    repository: { full_name: 'twojstar/llmbench' },
    pull_request: {
      draft: options.draft ?? false,
      base: { sha: options.baseSha ?? base },
      head: {
        sha: headSha,
        repo: {
          full_name: options.headRepository ?? 'twojstar/llmbench',
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

function fakeState(initial: Record<string, unknown> = {}): {
  alarms: number[];
  state: DurableObjectState;
  values: Map<string, unknown>;
} {
  const values = new Map(Object.entries(initial));
  const alarms: number[] = [];
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
    setAlarm(at: number) {
      alarms.push(at);
    },
  };
  return {
    alarms,
    values,
    state: { storage } as unknown as DurableObjectState,
  };
}

function queuedJob(headSha = headA, baseSha = base): Record<string, unknown> {
  return {
    body: JSON.stringify(payload(headSha, { baseSha })),
    target: {
      action: 'synchronize',
      baseSha,
      delivery: 'delivery-1',
      headSha,
      installationId: 123,
      number: 21,
      repository: 'twojstar/llmbench',
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

test('review file collection stops once the diff budget is full', () => {
  const patch = '@@ -0,0 +1 @@\n+' + 'x'.repeat(4_990);
  const files = Array.from({ length: 2 }, (_, index) => ({
    filename: `src/file-${index}.ts`,
    patch,
  }));
  assert.equal(reviewFileCollectionComplete(files, 5_000), true);
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
    repository: 'twojstar/llmbench',
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
    target?: { headSha?: string };
  };
  assert.equal(stored.target?.headSha, headB);
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
