import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  companionTargets,
  isCompanionEvent,
  readLimitedBody,
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
