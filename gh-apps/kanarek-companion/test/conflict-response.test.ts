import assert from 'node:assert/strict';
import test from 'node:test';

import { enrichConflictResponse } from '../src/conflict-response.ts';

const EXPECTED = '1'.repeat(40);
const CURRENT = '2'.repeat(40);

async function readPath(request: Request): Promise<string> {
  const value = await request.json() as { path?: string };
  return value.path ?? '';
}

test('enriches a stale branch-head conflict with expected and current SHA', async () => {
  const request = new Request('https://example.workers.dev/gpt-actions/github/commit-files', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repository: 'trvny/trvny',
      branch: 'feat/example',
      expectedHeadSha: EXPECTED,
    }),
  });
  const response = Response.json(
    { ok: false, error: 'branch_head_changed' },
    { status: 409 },
  );
  const calls: string[] = [];
  const enriched = await enrichConflictResponse(request, response, async (internalRequest) => {
    calls.push(await readPath(internalRequest));
    return Response.json({ ok: true, data: { object: { sha: CURRENT } } });
  });

  assert.equal(enriched.status, 409);
  const payload = await enriched.json() as {
    error: string;
    conflict: {
      resource: { type: string; repository: string; ref: string };
      expected: { headSha: string };
      current: { headSha: string };
      recovery: string;
    };
  };
  assert.equal(payload.error, 'branch_head_changed');
  assert.deepEqual(calls, ['/repos/trvny/trvny/git/ref/heads/feat/example']);
  assert.deepEqual(payload.conflict.resource, {
    type: 'branch',
    repository: 'trvny/trvny',
    ref: 'feat/example',
  });
  assert.equal(payload.conflict.expected.headSha, EXPECTED);
  assert.equal(payload.conflict.current.headSha, CURRENT);
  assert.equal(payload.conflict.recovery, 'refresh_context_and_retry');
});

test('enriches a stale default-branch conflict with the resolved branch name', async () => {
  const request = new Request('https://example.workers.dev/gpt-actions/github/changes/prepare', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer user-token',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      repository: 'trvny/trvny',
      branch: 'feat/example',
      expectedBaseSha: EXPECTED,
    }),
  });
  const response = Response.json(
    { ok: false, error: 'base_head_changed' },
    { status: 409 },
  );
  const calls: string[] = [];
  const enriched = await enrichConflictResponse(request, response, async (internalRequest) => {
    const path = await readPath(internalRequest);
    calls.push(path);
    if (path === '/repos/trvny/trvny') {
      return Response.json({ ok: true, data: { default_branch: 'main' } });
    }
    return Response.json({ ok: true, data: { object: { sha: CURRENT } } });
  });

  const payload = await enriched.json() as {
    conflict: {
      resource: { ref: string };
      expected: { headSha: string };
      current: { headSha: string };
    };
  };
  assert.deepEqual(calls, [
    '/repos/trvny/trvny',
    '/repos/trvny/trvny/git/ref/heads/main',
  ]);
  assert.equal(payload.conflict.resource.ref, 'main');
  assert.equal(payload.conflict.expected.headSha, EXPECTED);
  assert.equal(payload.conflict.current.headSha, CURRENT);
});

test('keeps the original conflict when current state cannot be read safely', async () => {
  const request = new Request('https://example.workers.dev/gpt-actions/github/commit-files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      repository: 'trvny/trvny',
      branch: 'feat/example',
      expectedHeadSha: EXPECTED,
    }),
  });
  const response = Response.json(
    { ok: false, error: 'branch_head_changed' },
    { status: 409 },
  );
  const enriched = await enrichConflictResponse(
    request,
    response,
    async () => new Response(null, { status: 502 }),
  );

  assert.equal(enriched.status, 409);
  assert.deepEqual(await enriched.json(), { ok: false, error: 'branch_head_changed' });
});
