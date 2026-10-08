import assert from 'node:assert/strict';
import test from 'node:test';

import { openRefreshReceipt, sealRefreshReceipt } from '../src/refresh-crypto.ts';

test('rotation receipt stores encrypted credentials, not plaintext bearer tokens', async () => {
  const original = { access_token: 'ghu_test-access', refresh_token: 'ghr_test-refresh' };
  const receipt = await sealRefreshReceipt(original, 'test-client-secret-value-123456', 'receipt-a', Date.now() + 1000);
  assert.equal(receipt.expiresAt > Date.now(), true);
  assert.ok(receipt.iv);
  assert.ok(receipt.ciphertext);
  assert.equal(JSON.stringify(receipt).includes('ghu_test-access'), false);
  assert.equal(JSON.stringify(receipt).includes('ghr_test-refresh'), false);
  assert.deepEqual(
    await openRefreshReceipt(receipt, 'test-client-secret-value-123456', 'receipt-a'),
    original,
  );
});

test('rotation receipts reject the wrong secret and receipt identifier', async () => {
  const receipt = await sealRefreshReceipt(
    { refresh_token: 'ghr_test-refresh' }, 'correct-test-client-secret', 'receipt-a', Date.now() + 1000,
  );
  await assert.rejects(openRefreshReceipt(receipt, 'incorrect-test-client-secret', 'receipt-a'));
  await assert.rejects(openRefreshReceipt(receipt, 'correct-test-client-secret', 'receipt-b'));
});
