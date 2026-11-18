import assert from 'node:assert/strict';
import test from 'node:test';
import { executePaidReviewOnce, runStrictPaidReviewStage } from '../src/companion/review-paid-receipt.ts';
import type { ReviewTarget } from '../src/companion/webhook-review.ts';
import { REVIEW_ROUTER_PAID_ONCE_PATH } from '../../core/review-service-protocol.ts';

function fixture() {
  const data = new Map<string, unknown>();
  let tail = Promise.resolve();
  const db = {
    async get(key: string) { return data.get(key); },
    async put(key: string, value: unknown) { data.set(key, value); },
    transaction<T>(callback: (txn: DurableObjectTransaction) => Promise<T>) {
      const result = tail.then(() => callback(db as unknown as DurableObjectTransaction));
      tail = result.then(() => {}, () => {});
      return result;
    },
  };
  return { store: db as unknown as DurableObjectStorage, data };
}
const target: ReviewTarget = {
  repository: 'trvny/trvny', number: 42, installationId: 123,
  action: 'synchronize', delivery: 'test', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40),
};
const yes = async () => true;

test('reservation is visible before paid I/O; overlap and replay do not call twice', async () => {
  const f = fixture();
  let calls = 0;
  const execute = () => executePaidReviewOnce(f.store, 'review-a', yes, async () => {
    calls += 1;
    assert.deepEqual([...f.data.values()], [{ state: 'reserved', id: 'review-a' }]);
    return { kind: 'no_review', reason: 'invalid_output' };
  });
  await Promise.all([execute(), execute()]);
  assert.equal((await execute()).state, 'settled');
  assert.equal(calls, 1);
});

test('lost response persists uncertainty and never retries', async () => {
  const f = fixture();
  let calls = 0;
  const run = () => executePaidReviewOnce(f.store, 'review-b', yes, async () => {
    calls += 1;
    throw new Error('response lost after billing');
  });
  assert.equal((await run()).state, 'uncertain');
  assert.equal((await run()).state, 'uncertain');
  assert.equal(calls, 1);
});

test('interrupted reservation survives restart; denied ownership never reserves', async () => {
  const f = fixture();
  const mustNotCall = async () => { throw new Error('unexpected paid I/O'); };
  await assert.rejects(executePaidReviewOnce(f.store, 'denied', async () => false, mustNotCall), /not_authorized/);
  assert.equal(f.data.size, 0);
  f.data.set('review-workflow:paid:interrupted', { state: 'reserved', id: 'interrupted' });
  assert.equal((await executePaidReviewOnce(f.store, 'interrupted', yes, mustNotCall)).state, 'reserved');
});

test('strict paid stage refuses active legacy runner and uses only versioned route', async () => {
  const f = fixture();
  let calls = 0;
  const env = {
    GITHUB_APP_ID: '', GITHUB_PRIVATE_KEY: '', KANAREK_REVIEW_ROUTER_TOKEN: 'token',
    KANAREK_REVIEW_SERVICE: {
      async fetch(input: Request | string) {
        calls += 1;
        const request = typeof input === 'string' ? new Request(input) : input;
        assert.equal(new URL(request.url).pathname, REVIEW_ROUTER_PAID_ONCE_PATH);
        return Response.json({ choices: [{ message: { content: '{"summary":"","findings":[]}' } }] },
          { headers: { 'x-kanarek-review-provider': 'deepseek' } });
      },
    },
  };
  await assert.rejects(runStrictPaidReviewStage(f.store, target, 'review', [], env, yes, yes), /legacy_active/);
  assert.equal(calls, 0);
  const disabled = { ...env, KANAREK_WEBHOOK_REVIEW_ENABLED: 'false' };
  const first = await runStrictPaidReviewStage(f.store, target, 'review', [], disabled, yes, yes);
  assert.equal(first.state, 'settled');
  assert.deepEqual(await runStrictPaidReviewStage(f.store, target, 'review', [], disabled, yes, yes), first);
  assert.equal(calls, 1);
});
