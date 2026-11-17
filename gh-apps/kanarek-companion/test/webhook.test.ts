import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { GptomekWebhookJob } from '../src/gptomek/gptomek-webhook.ts';

import worker, {
  COMMENT_WINDOW_MS,
  companionTargets,
  isCompanionEvent,
  readLimitedBody,
  repositoryAllowed,
  shouldCoalesceTarget,
  verifyWebhookSignature,
} from '../src/index.ts';

const env = {
  COMPANION_LOCK: {} as DurableObjectNamespace,
  GITHUB_APP_ID: '4472094',
  GITHUB_APP_SLUG: 'kanarek-companion',
  GITHUB_PRIVATE_KEY: 'configured-private-key',
  GITHUB_WEBHOOK_SECRET: 'test-secret',
  KANAREK_REPOSITORIES: 'trvny/trvny',
  KANAREK_QUIP_KV: {
    get: async () => null,
    put: async () => undefined,
  } as unknown as KVNamespace,
};

const testMetadata = {
  delivery: 'delivery-123',
  event: 'pull_request',
  action: 'opened',
  repository: 'trvny/trvny',
  installationId: 123,
};

test('allows owner repository wildcards without matching lookalike owners', () => {
  const wildcardEnv = { KANAREK_REPOSITORIES: 'trvny/*,travnie/*' };
  assert.equal(repositoryAllowed(wildcardEnv, 'trvny/trvny'), true);
  assert.equal(repositoryAllowed(wildcardEnv, 'trvny/feedseek'), true);
  assert.equal(repositoryAllowed(wildcardEnv, 'travnie/.github'), true);
  assert.equal(repositoryAllowed(wildcardEnv, 'travnie/Autka'), true);
  assert.equal(repositoryAllowed(wildcardEnv, 'trvny-evil/feedseek'), false);
  assert.equal(repositoryAllowed(wildcardEnv, 'travnie-evil/Autka'), false);
});

const controlEdit = {
  number: 176,
  pull_request: {
    body: '<!-- gptomek-command:dGVzdA -->',
    state: 'closed',
    user: { login: 'trvny' },
  },
};

test('validates the GitHub HMAC-SHA256 test vector', async () => {
  const payload = new TextEncoder().encode('Hello, World!').buffer;
  const signature =
    'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17';

  assert.equal(
    await verifyWebhookSignature("It's a Secret to Everybody", signature, payload),
    true,
  );
  assert.equal(
    await verifyWebhookSignature(
      "It's a Secret to Everybody",
      signature,
      new TextEncoder().encode('tampered').buffer,
    ),
    false,
  );
});

test('stops reading when the body exceeds the limit', async () => {
  const oversized = new Request('https://example.test/webhooks/github', {
    method: 'POST',
    body: '12345',
  });
  assert.equal(await readLimitedBody(oversized, 4), null);

  const accepted = new Request('https://example.test/webhooks/github', {
    method: 'POST',
    body: '12345',
  });
  const body = await readLimitedBody(accepted, 5);
  assert.equal(new TextDecoder().decode(body ?? new ArrayBuffer(0)), '12345');
});

test('supports HEAD health probes', async () => {
  const response = await worker.fetch(
    new Request('https://example.test/health', { method: 'HEAD' }),
    env,
  );
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

test('reports runtime readiness and optional integrations', async () => {
  const response = await worker.fetch(new Request('https://example.test/health'), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: 'kanarek-companion',
    appId: '4472094',
    appSlug: 'kanarek-companion',
    webhookConfigured: true,
    privateKeyConfigured: true,
    installationAuthConfigured: true,
    companionLockConfigured: true,
    quipBankConfigured: true,
    aiConfigured: false,
  });
});

test('requires bearer auth before waking the GPTomek issue mailbox', async () => {
  const unauthorized = await worker.fetch(
    new Request('https://example.test/gptomek/wake', { method: 'POST' }),
    { ...env, GPTOMEK_WAKE_TOKEN: 'wake-secret' },
  );
  assert.equal(unauthorized.status, 401);

  let target: unknown;
  const authorized = await worker.fetch(
    new Request('https://example.test/gptomek/wake', {
      method: 'POST',
      headers: { authorization: 'Bearer wake-secret' },
    }),
    {
      ...env,
      GPTOMEK_INSTALLATION_ID: '152126523',
      GPTOMEK_WAKE_TOKEN: 'wake-secret',
      COMPANION_LOCK: {
        idFromName: (name: string) => name,
        get: () => ({
          fetch: async (_url: string, init?: RequestInit) => {
            target = JSON.parse(String(init?.body ?? '{}'));
            return Response.json({
              ok: true,
              result: {
                changed: true,
                commentId: null,
                quipSource: 'preset',
                state: 'gptomek-control',
              },
            });
          },
        }),
      } as unknown as DurableObjectNamespace,
    },
  );
  assert.equal(authorized.status, 200);
  assert.equal((await authorized.json() as { handled: boolean }).handled, true);
  assert.equal((target as { pullRequestNumber?: number }).pullRequestNumber, 203);
});

test('normalizes GPTomek wake transport failures to 502', async () => {
  const response = await worker.fetch(
    new Request('https://example.test/gptomek/wake', {
      method: 'POST',
      headers: { authorization: 'Bearer wake-secret' },
    }),
    {
      ...env,
      GPTOMEK_INSTALLATION_ID: '152126523',
      GPTOMEK_WAKE_TOKEN: 'wake-secret',
      COMPANION_LOCK: {
        idFromName: (name: string) => name,
        get: () => ({ fetch: async () => { throw new Error('transport down'); } }),
      } as unknown as DurableObjectNamespace,
    },
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: 'gptomek_wake_failed' });
});

test('health honors per-provider disable switches', async () => {
  const disabled = await worker.fetch(new Request('https://example.test/health'), {
    ...env,
    OPENAI_API_KEY: 'test',
    KANAREK_OPENAI_ENABLED: 'false',
  });
  assert.equal((await disabled.json() as { aiConfigured: boolean }).aiConfigured, false);

  const enabled = await worker.fetch(new Request('https://example.test/health'), {
    ...env,
    OPENAI_API_KEY: 'test',
    KANAREK_OPENAI_ENABLED: 'true',
  });
  assert.equal((await enabled.json() as { aiConfigured: boolean }).aiConfigured, true);
});

test('reports not ready without the webhook secret', async () => {
  const response = await worker.fetch(new Request('https://example.test/health'), {
    ...env,
    GITHUB_WEBHOOK_SECRET: '',
  });
  assert.equal(response.status, 503);
});

test('routes the PR and review events used by the companion', async () => {
  assert.equal(isCompanionEvent(testMetadata), true);
  assert.equal(
    isCompanionEvent(
      { ...testMetadata, action: 'labeled' },
      { label: { name: 'no-goblin' } },
    ),
    true,
  );
  assert.equal(
    isCompanionEvent(
      { ...testMetadata, action: 'unlabeled' },
      { label: { name: 'NO-GOBLIN' } },
    ),
    true,
  );
  assert.equal(
    isCompanionEvent(
      { ...testMetadata, action: 'labeled' },
      { label: { name: 'bug' } },
    ),
    false,
  );
  assert.equal(isCompanionEvent({ ...testMetadata, action: 'assigned' }), false);
  assert.deepEqual(
    await companionTargets(testMetadata, { number: 156 }, env),
    [
      {
        delivery: 'delivery-123',
        installationId: 123,
        pullRequestNumber: 156,
        repository: 'trvny/trvny',
        sourceEvent: 'pull_request',
      },
    ],
  );
  assert.deepEqual(
    await companionTargets(
      { ...testMetadata, repository: 'someone/else' },
      { number: 156 },
      env,
    ),
    [],
  );
});

test('coalesces normal companion activity into ten-minute refresh windows', () => {
  const target = {
    delivery: 'delivery-123',
    installationId: 123,
    pullRequestNumber: 156,
    repository: 'trvny/trvny',
    sourceEvent: 'check_run',
  };
  assert.equal(COMMENT_WINDOW_MS, 10 * 60 * 1_000);
  for (const sourceEvent of [
    'check_run',
    'check_suite',
    'status',
    'workflow_run',
    'pull_request',
    'pull_request_review',
  ]) {
    assert.equal(shouldCoalesceTarget({ ...target, sourceEvent }), true);
  }
  assert.equal(
    shouldCoalesceTarget({ ...target, sourceEvent: 'issues' }),
    false,
  );
  assert.equal(
    shouldCoalesceTarget({ ...target, sourceEvent: 'review_job' }),
    false,
  );
  assert.equal(
    shouldCoalesceTarget({
      ...target,
      pullRequestNumber: 176,
      sourceEvent: 'pull_request',
    }),
    false,
  );
});

test('routes only marked edits of the GPTomek control mailbox', async () => {
  const edited = { ...testMetadata, action: 'edited' };
  assert.equal(isCompanionEvent(edited, controlEdit), true);
  assert.equal(
    isCompanionEvent(edited, {
      ...controlEdit,
      number: 177,
    }),
    false,
  );
  assert.equal(
    isCompanionEvent(edited, {
      ...controlEdit,
      pull_request: { ...controlEdit.pull_request, body: 'idle' },
    }),
    false,
  );
  assert.equal(
    isCompanionEvent(edited, {
      ...controlEdit,
      pull_request: {
        ...controlEdit.pull_request,
        user: { login: 'someone' },
      },
    }),
    false,
  );
  assert.deepEqual(
    await companionTargets(edited, controlEdit, env),
    [
      {
        delivery: 'delivery-123',
        installationId: 123,
        pullRequestNumber: 176,
        repository: 'trvny/trvny',
        sourceEvent: 'pull_request',
      },
    ],
  );
});


test('direct ingress verifies separate HMAC, scopes created commands and defaults to standby', async () => {
  const now = new Date().toISOString();
  const payload = {
    action: 'created', repository: { full_name: 'trvny/trvny' },
    installation: { id: 123 }, sender: { login: 'trvny' },
    issue: { number: 203, state: 'open', user: { login: 'trvny' } },
    comment: { id: 777, user: { login: 'trvny' }, created_at: now, updated_at: now,
      body: '\x60\x60\x60gptomek\n{}\n\x60\x60\x60' },
  };
  const queued: unknown[] = [];
  const config = {
    ...env, GPTOMEK_WEBHOOK_SECRET: 'separate-secret', GPTOMEK_INSTALLATION_ID: '123',
    GPTOMEK_WEBHOOK_JOBS: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async (_url: string, init: RequestInit) => {
        queued.push(JSON.parse(String(init.body)));
        return Response.json({ ok: true });
      } }),
    } as unknown as DurableObjectNamespace,
  };
  const send = (value: unknown, event = 'issue_comment', secret = 'separate-secret', primary = true) => {
    const body = JSON.stringify(value);
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    return worker.fetch(new Request('https://example.test/webhooks/gptomek', {
      method: 'POST', body, headers: { 'x-github-event': event, 'x-hub-signature-256': 'sha256=' + signature },
    }), { ...config, GPTOMEK_WEBHOOK_PRIMARY: primary ? 'true' : undefined });
  };
  assert.equal((await send(payload, 'issue_comment', 'test-secret')).status, 401);
  assert.equal((await send({}, 'ping', 'separate-secret', false)).status, 200);
  assert.equal((await send(payload, 'issue_comment', 'separate-secret', false)).status, 202);
  for (const value of [
    { ...payload, action: 'edited' }, { ...payload, installation: { id: 456 } },
    { ...payload, issue: { ...payload.issue, number: 204 } },
    { ...payload, sender: { login: 'other' } },
    { ...payload, comment: { ...payload.comment, body: 'ordinary comment' } },
    { ...payload, comment: { ...payload.comment, updated_at: '2000-01-01T00:00:00Z' } },
  ]) assert.equal((await send(value)).status, 202);
  assert.equal(queued.length, 0);
  assert.deepEqual(await (await send(payload)).json(), { accepted: true, queued: true, duplicate: false });
  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0], { commentId: 777, installationId: 123,
    bodySha256: (await import('node:crypto')).createHash('sha256').update(payload.comment.body).digest('hex') });
});

test('webhook job persists before ACK, retries transport and separates acknowledged cleanup', async () => {
  const data = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    get: async (key: string) => data.get(key),
    put: async (key: string, value: unknown) => { data.set(key, value); },
    delete: async (key: string) => data.delete(key),
    setAlarm: async (at: number) => { alarm = at; },
  };
  const calls: Array<{ cleanupComment: boolean; expectedCommentBodySha256: string }> = [];
  const config = {
    ...env,
    COMPANION_LOCK: {
      idFromName: (name: string) => name,
      get: () => ({ fetch: async (_url: string, init: RequestInit) => {
        const target = JSON.parse(String(init.body));
        calls.push(target);
        if (calls.length === 1) return Response.json({ ok: false }, { status: 502 });
        return Response.json({ ok: true, result: {
          state: 'gptomek-comment-ok', commentCleanup: target.cleanupComment ? 'deleted' : null,
        } });
      } }),
    } as unknown as DurableObjectNamespace,
  };
  const make = () => new GptomekWebhookJob({ storage } as unknown as DurableObjectState, config);
  const request = () => new Request('https://internal/enqueue', {
    method: 'POST', body: JSON.stringify({ commentId: 777, installationId: 123, bodySha256: 'a'.repeat(64) }),
  });
  assert.equal((await make().fetch(request())).status, 200);
  assert.notEqual(alarm, null);
  assert.equal(calls.length, 0);
  assert.deepEqual(await (await make().fetch(request())).json(), { ok: true, duplicate: true });
  await make().alarm();
  assert.equal((data.get('job') as { phase: string }).phase, 'execute');
  await make().alarm();
  assert.equal((data.get('job') as { phase: string }).phase, 'cleanup');
  await make().alarm();
  assert.equal((data.get('job') as { phase: string }).phase, 'done');
  assert.deepEqual(calls.map(c => c.cleanupComment), [false, false, true]);
  assert.ok(calls.every(c => c.expectedCommentBodySha256 === 'a'.repeat(64)));
});
