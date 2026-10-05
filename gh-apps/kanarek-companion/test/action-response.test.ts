import assert from 'node:assert/strict';
import test from 'node:test';

import { actionResponseObject } from '../src/tools/common.ts';

class TestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const error = (code: string, status?: number) => new TestError(code, status);

test('action response returns payload on success', async () => {
  const payload = await actionResponseObject(Response.json({ ok: true, data: 1 }), error);
  assert.deepEqual(payload, { ok: true, data: 1 });
});

test('action response maps non-JSON and non-object bodies to 502', async () => {
  for (const response of [new Response('nope'), Response.json([1])]) {
    await assert.rejects(actionResponseObject(response, error), {
      code: 'invalid_action_response',
      status: 502,
    });
  }
});

test('action response prefers payload.error, else fallback', async () => {
  await assert.rejects(
    actionResponseObject(Response.json({ error: 'nope' }, { status: 403 }), error),
    { code: 'nope', status: 403 },
  );
  await assert.rejects(
    actionResponseObject(Response.json({}, { status: 500 }), error),
    { code: 'action_failed', status: 500 },
  );
  await assert.rejects(
    actionResponseObject(Response.json({}, { status: 404 }), error, {
      fallback: (status) => `read_${status}`,
    }),
    { code: 'read_404', status: 404 },
  );
});

test('requireOk rejects HTTP 200 without ok: true', async () => {
  const body = { ok: false };
  assert.deepEqual(await actionResponseObject(Response.json(body), error), body);
  await assert.rejects(
    actionResponseObject(Response.json(body), error, { requireOk: true }),
    { code: 'action_failed', status: 200 },
  );
});
