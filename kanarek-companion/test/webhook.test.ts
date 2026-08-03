import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  readLimitedBody,
  verifyWebhookSignature,
} from '../src/index.ts';

const env = {
  GITHUB_APP_ID: '4472094',
  GITHUB_APP_SLUG: 'kanarek-companion',
  GITHUB_PRIVATE_KEY: 'configured-private-key',
  GITHUB_WEBHOOK_SECRET: 'test-secret',
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

test('reports not ready without the webhook secret', async () => {
  const response = await worker.fetch(new Request('https://example.test/health'), {
    ...env,
    GITHUB_WEBHOOK_SECRET: '',
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    service: 'kanarek-companion',
    appId: '4472094',
    appSlug: 'kanarek-companion',
    webhookConfigured: false,
    privateKeyConfigured: true,
    installationAuthConfigured: true,
  });
});

test('reports not ready without the GitHub App private key', async () => {
  const response = await worker.fetch(new Request('https://example.test/health'), {
    ...env,
    GITHUB_PRIVATE_KEY: '',
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    service: 'kanarek-companion',
    appId: '4472094',
    appSlug: 'kanarek-companion',
    webhookConfigured: true,
    privateKeyConfigured: false,
    installationAuthConfigured: false,
  });
});
