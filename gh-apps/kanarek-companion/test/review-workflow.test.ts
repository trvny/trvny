import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import type { WorkflowStep } from 'cloudflare:workers';
import {
  checkpointFreeSweep,
  checkpointReviewJudge,
  previewReviewPublication,
  restoreReviewSnapshot,
  runFreeReviewWorkflowSmoke,
  workflowProviderAt,
  runFreeReviewWorkflowPrototype,
  serializeReviewSnapshot,
  workflowReadOnlyFetch,
  workflowFreeOrder,
  workflowRouteOrder,
  workflowStatus,
} from '../src/companion/review-workflow.ts';
import type { ReviewRouterOutcome, ReviewSweepResult, StoredJob } from '../src/companion/webhook-review.ts';
import type { WebhookReviewEnv } from '../src/companion/webhook-review-context.ts';
import { REVIEW_PROVIDER_ONLY_HEADER, REVIEW_ROUTER_CODE_REVIEW_MODEL, REVIEW_ROUTER_PATH, REVIEW_WORKERS_AI_OVERRIDE_HEADER } from '../../core/review-service-protocol.ts';

function journal() {
  const checkpoints = new Map<string, unknown>();
  const calls: string[] = [];
  const step = {
    async do(name: string, config: { retries: { limit: number } }, callback: () => Promise<unknown>) {
      assert.equal(config.retries.limit, 0);
      if (!checkpoints.has(name)) {
        calls.push(name);
        checkpoints.set(name, await callback());
      }
      return checkpoints.get(name);
    },
  } as unknown as Pick<WorkflowStep, 'do'>;
  return { calls, step, checkpoints };
}

const clean = (provider: string): ReviewRouterOutcome => ({
  kind: 'ok', review: { provider, model: 'test', parsed: { summary: '', findings: [] } },
});

const manualJob: StoredJob = {
  phase: 'free',
  target: {
    repository: 'trvny/trvny', number: 44, installationId: 123,
    headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40),
    delivery: 'manual-test', action: 'synchronize',
  },
};

test('manual workflow rejects out-of-scope and paid jobs before I/O', async () => {
  const { step, calls } = journal();
  const env: WebhookReviewEnv = {
    GITHUB_APP_ID: '1', GITHUB_PRIVATE_KEY: '',
    KANAREK_REVIEW_ROUTER_TOKEN: 'test-token', KANAREK_REVIEW_REPOSITORIES: 'trvny/trvny',
  };
  const fetcher: typeof fetch = async () => { throw new Error('unexpected I/O'); };
  for (const repository of ['other/repo', 'travnie/other', 'trvny/trvny/extra']) {
    await assert.rejects(runFreeReviewWorkflowPrototype({
      ...manualJob, target: { ...manualJob.target, repository },
    }, env, step, fetcher), /repository_out_of_scope/);
  }
  await assert.rejects(runFreeReviewWorkflowPrototype({
    ...manualJob, target: { ...manualJob.target, repository: 'trvny/other' },
  }, {
    ...env, KANAREK_REPOSITORIES: 'trvny/trvny', KANAREK_REVIEW_REPOSITORIES: 'trvny/*',
  }, step, fetcher), /repository_out_of_scope/);
  await assert.rejects(runFreeReviewWorkflowPrototype({
    ...manualJob, phase: 'paid',
  }, env, step, fetcher), /invalid_free_review_job/);
  assert.deepEqual(calls, []);
});

test('manual workflow fetch cannot publish or mint another installation token', async () => {
  const calls: string[] = [];
  const fetcher = workflowReadOnlyFetch(manualJob.target, async (input) => {
    calls.push(String(input));
    return new Response();
  });
  const origin = 'https://api.github.com';
  await fetcher(origin + '/repos/trvny/trvny/pulls/44');
  await fetcher(origin + '/app/installations/123/access_tokens', { method: 'POST' });
  for (const path of ['/repos/trvny/trvny/pulls/44/reviews', '/app/installations/456/access_tokens']) {
    await assert.rejects(fetcher(origin + path, { method: 'POST' }), /read_only/);
  }
  assert.equal(calls.length, 2);
});

test('manual workflow runs real preparation and strict free service calls, then replays', async () => {
  const { step, calls } = journal();
  const githubCalls: string[] = [];
  const providers: string[] = [];
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
    .export({ type: 'pkcs1', format: 'pem' }).toString();
  const target = manualJob.target;
  const env: WebhookReviewEnv = {
    GITHUB_APP_ID: '1', GITHUB_PRIVATE_KEY: key,
    KANAREK_REVIEW_ROUTER_TOKEN: 'test-token',
    KANAREK_REVIEW_REPOSITORIES: 'trvny/*',
    KANAREK_REVIEW_WORKERS_AI_ENABLED: 'true',
    KANAREK_REVIEW_SERVICE: {
      async fetch(input) {
        const request = input instanceof Request ? input : new Request(input);
        if (new URL(request.url).pathname === '/health') {
          return Response.json({ providerPool: {
            available: 2, configured: 2, ready: true, strictFreeReviewSelector: true,
            taskOrders: { review: ['openrouter', 'workers-ai', 'groq'] }, providers: [],
          } });
        }
        assert.equal(new URL(request.url).pathname, REVIEW_ROUTER_PATH);
        assert.equal(request.headers.get(REVIEW_WORKERS_AI_OVERRIDE_HEADER), 'false');
        const body = await request.json() as { model: string };
        assert.equal(body.model, REVIEW_ROUTER_CODE_REVIEW_MODEL);
        const provider = request.headers.get(REVIEW_PROVIDER_ONLY_HEADER);
        assert.ok(provider);
        providers.push(provider);
        return Response.json({ model: 'test-model', choices: [{
          message: { content: JSON.stringify({ summary: '没有发现问题。', findings: [] }) },
        }] }, { headers: { 'x-kanarek-review-provider': provider } });
      },
    },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    githubCalls.push(url.pathname);
    if (url.pathname === '/app/installations/123/access_tokens') {
      assert.equal(init?.method, 'POST');
      return Response.json({ token: 'test-installation', expires_at: '2099-01-01T00:00:00Z' });
    }
    assert.equal(init?.method ?? 'GET', 'GET');
    if (url.pathname.endsWith('/pulls/44')) return Response.json({
      state: 'open', draft: false, user: { login: 'dev' }, labels: [],
      head: { sha: target.headSha, repo: { full_name: target.repository } },
      base: { sha: target.baseSha }, changed_files: 1, title: 'Example', body: '',
    });
    if (url.pathname.endsWith('/reviews')) return Response.json([]);
    if (url.pathname.endsWith('/files')) return Response.json([{
      filename: 'src/a.ts', status: 'added', patch: '@@ -0,0 +1 @@\n+const a = 1;',
    }]);
    if (url.pathname.includes('/git/trees/')) return Response.json({ tree: [] });
    if (url.pathname === '/search/code') return Response.json({ items: [], total_count: 0 });
    throw new Error('unexpected GitHub read: ' + url.pathname);
  };
  const first = await runFreeReviewWorkflowPrototype(manualJob, env, step, fetcher);
  assert.equal(first.status, 'completed');
  assert.equal('publication' in first && first.publication.kind, 'silent');
  assert.deepEqual(providers, ['openrouter', 'groq']);
  assert.deepEqual(calls, ['prepare', 'route', 'free-1-openrouter', 'free-2-groq', 'verify-head', 'publication-preview']);
  const githubCount = githubCalls.length;
  assert.deepEqual(await runFreeReviewWorkflowPrototype(manualJob, env, step, fetcher), first);
  assert.equal(githubCalls.length, githubCount);
  assert.deepEqual(providers, ['openrouter', 'groq']);
});

test('checkpoint index is an in-range integer for a known free provider', () => {
  const order = ['openrouter', 'groq'];
  for (const index of [-1, 2, 0.5, NaN, Infinity]) {
    assert.throws(() => workflowProviderAt(order, index), /invalid_provider_index/);
  }
  assert.throws(() => workflowProviderAt(['xai'], 0), /invalid_provider_index/);
  assert.equal(workflowProviderAt(order, 1), 'groq');
});

test('publication preview mirrors clean, partial, invalid, stale and judged outcomes', () => {
  const target = manualJob.target;
  const l2 = { stale: false, judged: null, marker: null };
  const generated = { provider: 'groq', model: 'test', parsed: { summary: '', findings: [] } };
  const empty: ReviewSweepResult = {
    attempts: 0, disposition: null, excluded: [], findings: [], generated: null,
  };
  const cleanResult: ReviewSweepResult = { ...empty, generated, disposition: 'clean' };
  assert.deepEqual(previewReviewPublication(target, cleanResult, l2, 'completed'),
    { kind: 'silent', reason: 'no_findings', findingCount: 0 });
  assert.equal(previewReviewPublication(target, cleanResult, l2, 'stale').kind, 'skip');
  for (const status of ['budget', 'completed'] as const) {
    assert.deepEqual(previewReviewPublication(target, empty, l2, status),
      { kind: 'escalate', reason: 'paid_escalation_needed', findingCount: 0 });
  }
  assert.equal(previewReviewPublication(target, {
    ...cleanResult, generated: { ...generated, partial: true },
  }, l2, 'completed').kind, 'escalate');
  assert.equal(previewReviewPublication(target, {
    ...cleanResult, disposition: 'invalid_findings',
  }, l2, 'completed').kind, 'escalate');
  const finding = { severity: 'high' as const, path: 'src/a.ts', line: 1,
    title: '问题', body: '缺陷', existingCode: 'x' };
  const publish: ReviewSweepResult = { ...cleanResult, disposition: 'publish', findings: [finding] };
  assert.deepEqual(previewReviewPublication(target, publish, l2, 'completed'),
    { kind: 'comment', reason: null, findingCount: 1 });
  assert.deepEqual(previewReviewPublication(target, publish, {
    ...l2, judged: { findings: [], provider: 'vercel-decision', model: 'test' },
  }, 'completed'), { kind: 'silent', reason: 'no_findings_judged', findingCount: 0 });
});

test('binding smoke only reads router health and persists sample checkpoint', async () => {
  const { step, calls } = journal();
  let reads = 0;
  const env: WebhookReviewEnv = {
    GITHUB_APP_ID: '', GITHUB_PRIVATE_KEY: '',
    KANAREK_REVIEW_SERVICE: {
      async fetch(input) {
        const request = input instanceof Request ? input : new Request(input);
        assert.equal(new URL(request.url).pathname, '/health');
        assert.equal(request.method, 'GET');
        reads += 1;
        return Response.json({ providerPool: {
          available: 1, configured: 1, ready: true, strictFreeReviewSelector: true,
          taskOrders: { review: ['groq', 'workers-ai'] }, providers: [],
        } });
      },
    },
  };
  const result = await runFreeReviewWorkflowSmoke(env, step);
  assert.deepEqual(result, { mode: 'binding-smoke', status: 'completed', providerCount: 1 });
  assert.deepEqual(await runFreeReviewWorkflowSmoke(env, step), result);
  assert.deepEqual(calls, ['smoke-router', 'smoke-snapshot']);
  assert.equal(reads, 1);
});

test('workflow refuses an older router before inference', () => {
  const health = {
    available: 1, configured: 1, ready: true,
    taskOrders: { review: ['openrouter', 'workers-ai', 'groq'] },
    providers: [],
  };
  assert.throws(() => workflowRouteOrder(health), /selector_unsupported/);
  assert.deepEqual(workflowRouteOrder({ ...health, strictFreeReviewSelector: true }), ['openrouter', 'groq']);
});

test('workflow snapshot round trips verification line sets', () => {
  const snapshot = restoreReviewSnapshot(serializeReviewSnapshot({
    kind: 'ready', reviewInput: 'prompt', diffChars: 3, contextChars: 4,
    verifiableFiles: [{ path: 'src/a.ts', patch: '+x', rightLines: new Set([1, 3]), sha: null }],
  }));
  assert.equal(snapshot.kind, 'ready');
  if (snapshot.kind === 'ready') assert.deepEqual([...snapshot.verifiableFiles[0].rightLines], [1, 3]);
});

test('journal replay uses saved provider results even after the budget expires', async () => {
  const { step, calls } = journal();
  const asked: string[] = [];
  let now = 0;
  const run = () => checkpointFreeSweep(step, ['openrouter', 'aihubmix', 'groq'], 1000, [],
    async () => true, async (provider) => {
      asked.push(provider);
      return provider === 'openrouter' ? { kind: 'unavailable' } : clean(provider);
    }, () => now);
  const first = await run();
  assert.equal(first.sweep.disposition, 'clean');
  assert.equal(first.sweep.attempts, 3);
  now = 2000;
  const replay = await run();
  assert.deepEqual(replay, first);
  assert.deepEqual(asked, ['openrouter', 'aihubmix', 'groq']);
  assert.equal(calls.length, 3);
});

test('new provider step stops when head is stale', async () => {
  const { step } = journal();
  let calls = 0;
  const result = await checkpointFreeSweep(step, ['openrouter', 'groq'], 1000, [],
    async () => false, async (provider) => { calls += 1; return clean(provider); }, () => 0);
  assert.equal(result.stopped, 'stale');
  assert.equal(result.sweep.attempts, 0);
  assert.equal(calls, 0);
});

test('workflow rejects invalid, paid and empty routes before provider I/O', async () => {
  for (const order of [[], ['workers-ai'], ['xai'], ['openrouter', 'unknown'], null]) {
    assert.throws(() => workflowFreeOrder(order), /order_unavailable/);
  }
  assert.deepEqual(workflowFreeOrder(['workers-ai', 'groq', 'groq', 'openrouter']), ['groq', 'openrouter']);
  const { step, calls } = journal();
  await assert.rejects(checkpointFreeSweep(step, ['deepseek'], 1000, [], async () => true, async (id) => clean(id)), /order_unavailable/);
  assert.deepEqual(calls, []);
});

test('escape-heavy snapshot must fit the persisted outer JSON', () => {
  assert.throws(() => serializeReviewSnapshot({
    kind: 'ready', reviewInput: '\\'.repeat(250_000), diffChars: 0, contextChars: 0, verifiableFiles: [],
  }), /snapshot_too_large/);
});

test('gateway exception is checkpointed and replay does not send another request', async () => {
  const { step } = journal();
  const asked: string[] = [];
  const run = () => checkpointFreeSweep(step, ['openrouter', 'groq'], 1000, [],
    async () => true, async (provider) => {
      asked.push(provider);
      if (provider === 'openrouter') throw new DOMException('network timeout', 'AbortError');
      return clean(provider);
    }, () => 0);
  const first = await run();
  assert.equal(first.sweep.disposition, 'clean');
  assert.equal(first.sweep.attempts, 2);
  assert.deepEqual(await run(), first);
  assert.deepEqual(asked, ['openrouter', 'groq']);
});

test('final in-flight budget exhaustion persists attempted provider and survives replay', async () => {
  const { step } = journal();
  let now = 0;
  let calls = 0;
  const run = () => checkpointFreeSweep(step, ['groq'], 1000, [],
    async () => true, async (provider) => {
      now = 1000;
      calls += 1;
      return clean(provider);
    }, () => now);
  const first = await run();
  assert.equal(first.stopped, 'budget');
  assert.equal(first.sweep.aborted, true);
  assert.equal(first.sweep.attempts, 1);
  assert.equal(first.sweep.disposition, null);
  assert.deepEqual(await run(), first);
  assert.equal(calls, 1);
});

test('escape-heavy outcome falls back without persisting oversized state', async () => {
  const { step, checkpoints } = journal();
  const result = await checkpointFreeSweep(step, ['openrouter', 'groq'], 1000, [],
    async () => true, async (provider) => {
      if (provider !== 'openrouter') return clean(provider);
      return { kind: 'ok', review: { provider, model: 'test', parsed: { summary: '\\'.repeat(250_000), findings: [] } } };
    }, () => 0);
  assert.equal(result.sweep.attempts, 2);
  assert.equal(result.sweep.generated?.provider, 'groq');
  const stored = checkpoints.get('free-1-openrouter');
  assert.equal(typeof stored, 'string');
  assert.deepEqual(JSON.parse(stored as string), {
    attempt: { kind: 'attempt', outcome: { kind: 'invalid', provider: 'openrouter' }, aborted: false },
    stopped: null,
  });
  assert.ok(new TextEncoder().encode(JSON.stringify(stored)).byteLength <= 900_000);
});

test('freshness check crossing deadline checkpoints budget before stale', async () => {
  const { step, checkpoints } = journal();
  let now = 0;
  let checks = 0;
  let requests = 0;
  const run = () => checkpointFreeSweep(step, ['openrouter'], 1000, [], async (signal) => {
    assert.ok(signal instanceof AbortSignal);
    checks += 1;
    now = 1000;
    return false;
  }, async (provider) => { requests += 1; return clean(provider); }, () => now);
  const first = await run();
  assert.equal(first.stopped, 'budget');
  assert.equal(first.sweep.attempts, 0);
  assert.deepEqual(JSON.parse(checkpoints.get('free-1-openrouter') as string),
    { attempt: { kind: 'stop' }, stopped: 'budget' });
  assert.deepEqual(await run(), first);
  assert.equal(checks, 1);
  assert.equal(requests, 0);
});

test('aborted freshness fetch at the deadline persists a budget stop', async () => {
  const { step } = journal();
  let requests = 0;
  const result = await checkpointFreeSweep(step, ['groq'], 5, [], async (signal) => {
    const hold = setTimeout(() => {}, 100);
    try {
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    } finally {
      clearTimeout(hold);
    }
    return true;
  }, async (provider) => { requests += 1; return clean(provider); }, () => 0);
  assert.equal(result.stopped, 'budget');
  assert.equal(result.sweep.attempts, 0);
  assert.equal(requests, 0);
});

test('freshness network error before deadline fails closed', async () => {
  const { step } = journal();
  await assert.rejects(checkpointFreeSweep(step, ['groq'], 1000, [], async () => {
    throw new Error('github down');
  }, async () => { throw new Error('must not infer'); }, () => 0), /github down/);
});

test('stale status wins over budget and completion', () => {
  assert.equal(workflowStatus('budget', false), 'stale');
  assert.equal(workflowStatus('stale', true), 'stale');
  assert.equal(workflowStatus('budget', true), 'budget');
  assert.equal(workflowStatus(null, true), 'completed');
});

test('L2 decision checkpoint suppresses fallback and replays without inference', async () => {
  const { step, calls } = journal();
  const judged = { findings: [], model: 'decision', provider: 'vercel-decision' };
  let decisions = 0;
  const run = () => checkpointReviewJudge(step, async () => true, async () => {
    decisions += 1;
    return { judged, marker: 'ok' };
  }, async () => { throw new Error('must not fall back'); });
  const first = await run();
  assert.deepEqual(first, { stale: false, judged, marker: 'ok' });
  assert.deepEqual(await run(), first);
  assert.equal(decisions, 1);
  assert.deepEqual(calls, ['l2-decision']);
});

test('L2 failed decision and fallback checkpoints replay without repeat calls', async () => {
  const { step, calls } = journal();
  let decisions = 0;
  let judges = 0;
  const run = () => checkpointReviewJudge(step, async () => true, async () => {
    decisions += 1;
    throw new Error('decision unavailable');
  }, async () => {
    judges += 1;
    throw new Error('judge unavailable');
  });
  const first = await run();
  assert.deepEqual(first, { stale: false, judged: null, marker: null });
  assert.deepEqual(await run(), first);
  assert.equal(decisions, 1);
  assert.equal(judges, 1);
  assert.deepEqual(calls, ['l2-decision', 'l2-generative']);
});

test('L2 retains the decision marker if generative fallback fails or exceeds checkpoint size', async () => {
  for (const fail of ['throw', 'oversize'] as const) {
    const { step, calls } = journal();
    let judges = 0;
    const run = () => checkpointReviewJudge(step, async () => true,
      async () => ({ judged: null, marker: 'unavailable' }),
      async () => {
        judges += 1;
        if (fail === 'throw') throw new Error('judge unavailable');
        return { findings: [], provider: 'groq', model: '\\'.repeat(250_000) };
      });
    const first = await run();
    assert.deepEqual(first, { stale: false, judged: null, marker: 'unavailable' });
    assert.deepEqual(await run(), first);
    assert.equal(judges, 1);
    assert.deepEqual(calls, ['l2-decision', 'l2-generative']);
  }
});

test('L2 rechecks head before generative fallback', async () => {
  const { step } = journal();
  let checks = 0;
  let judges = 0;
  const result = await checkpointReviewJudge(step, async () => ++checks === 1,
    async () => ({ judged: null, marker: 'unavailable' }),
    async () => { judges += 1; return null; });
  assert.equal(result.stale, true);
  assert.equal(judges, 0);
});

test('wrong-provider answer cannot certify a free review', async () => {
  const { step } = journal();
  const result = await checkpointFreeSweep(step, ['openrouter', 'groq'], 1000, [],
    async () => true, async () => clean('unexpected'), () => 0);
  assert.equal(result.sweep.disposition, null);
  assert.equal(result.sweep.attempts, 2);
});
