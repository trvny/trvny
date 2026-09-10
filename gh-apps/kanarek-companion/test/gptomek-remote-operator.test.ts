import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import {
  commandMarker,
  gptomekOperatorActionAllowed,
  gptomekReplayCommentMatches,
  handleGptomekControl,
  handleGptomekMailboxCommand,
  resultMarker,
} from '../src/gptomek.ts';
import type { CompanionEnv, CompanionTarget, PullRequest } from '../src/companion-types.ts';

const target: CompanionTarget = {
  delivery: 'delivery-remote-operator',
  installationId: 1,
  pullRequestNumber: 176,
  repository: 'trvny/trvny',
  sourceEvent: 'pull_request',
};

const controlPr: PullRequest = {
  additions: 1,
  auto_merge: null,
  base: { ref: 'main', sha: 'a'.repeat(40) },
  body: 'GPTomek control channel.',
  changed_files: 1,
  deletions: 0,
  draft: true,
  head: {
    ref: 'gptomek/control',
    repo: { full_name: 'trvny/trvny' },
    sha: 'b'.repeat(40),
  },
  labels: [],
  mergeable: true,
  mergeable_state: 'clean',
  merged: true,
  number: 176,
  state: 'closed',
  title: 'GPTomek control channel',
  user: { login: 'trvny' },
};

test('shares GPT Actions policy while keeping high-level raw writes out of operator_action', () => {
  assert.equal(
    gptomekOperatorActionAllowed(
      'trvny/trvny',
      'PATCH',
      '/repos/trvny/trvny/issues/203',
      { labels: ['gptomek-wake'] },
    ),
    true,
  );
  assert.equal(
    gptomekOperatorActionAllowed(
      'twojstar/twojstar',
      'PATCH',
      '/repos/twojstar/twojstar/issues/1',
      { state: 'closed' },
    ),
    true,
  );
  assert.equal(
    gptomekOperatorActionAllowed(
      'twojstar/twojstar',
      'POST',
      '/repos/twojstar/twojstar/actions/workflows/test.yml/dispatches',
      { ref: 'main' },
    ),
    false,
  );
  assert.equal(
    gptomekOperatorActionAllowed(
      'trvny/trvny',
      'PATCH',
      '/repos/trvny/trvny/git/refs/heads/main',
      { sha: 'a'.repeat(40), force: true },
    ),
    false,
  );
  assert.equal(
    gptomekOperatorActionAllowed(
      'trvny/trvny',
      'DELETE',
      '/repos/trvny/trvny/git/refs/heads/gptomek/control',
    ),
    false,
  );
  assert.equal(
    gptomekOperatorActionAllowed(
      'trvny/trvny',
      'POST',
      '/repos/trvny/trvny/pulls',
      { title: 'must stay human-authored' },
    ),
    false,
  );
  assert.equal(
    gptomekOperatorActionAllowed(
      'trvny/trvny',
      'PATCH',
      '/repos/trvny/feedseek/issues/1',
      { state: 'closed' },
    ),
    false,
  );
});

test('accepts replay markers only from gptomek[bot]', () => {
  const body = 'done\n\n<!-- gptomek-id:comment-1 -->';
  assert.equal(
    gptomekReplayCommentMatches({ body, user: { login: 'trvny' } }, 'comment-1'),
    false,
  );
  assert.equal(
    gptomekReplayCommentMatches({ body, user: { login: 'gptomek[bot]' } }, 'comment-1'),
    true,
  );
  assert.equal(
    gptomekReplayCommentMatches({ body, user: { login: 'gptomek[bot]' } }, 'comment-2'),
    false,
  );
});

test('accepts operator_action commands before authentication', async () => {
  const body = commandMarker({
    id: 'operator-action-1',
    op: 'operator_action',
    repository: 'twojstar/twojstar',
    method: 'PATCH',
    path: '/repos/twojstar/twojstar/issues/1',
    body: { state: 'closed' },
  });
  await assert.rejects(
    handleGptomekControl(target, { ...controlPr, body }, {} as CompanionEnv),
    /invalid_gptomek_app_id/,
  );
});

test('clears terminal operator-action policy rejections from the mailbox', async () => {
  const body = commandMarker({
    id: 'operator-action-policy-rejection',
    op: 'operator_action',
    repository: 'trvny/trvny',
    method: 'POST',
    path: '/repos/trvny/trvny/actions/workflows/automation-sync.yml/dispatches',
    body: { ref: 'main' },
    expect: 'empty',
  });
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs1', format: 'pem' })
    .toString();
  const calls: string[] = [];
  let patchedBody = '';
  const fetcher = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${url}`);

    if (url.endsWith('/app/installations/123/access_tokens')) {
      return Response.json({
        token: 'ghs_gptomek_test',
        expires_at: '2099-01-01T00:00:00Z',
      });
    }
    if (url.endsWith('/repos/trvny/trvny/installation')) {
      return Response.json({ id: 123 });
    }
    if (
      url.endsWith('/repos/trvny/trvny/issues/203') &&
      method === 'PATCH'
    ) {
      const payload = JSON.parse(String(init?.body)) as { body?: string };
      patchedBody = payload.body ?? '';
      return Response.json({ id: 203 });
    }
    return new Response(null, { status: 404 });
  };

  const result = await handleGptomekMailboxCommand(
    body,
    '/repos/trvny/trvny/issues/203',
    {
      GPTOMEK_APP_ID: '4524407',
      GPTOMEK_INSTALLATION_ID: '123',
      GPTOMEK_PRIVATE_KEY: privateKey,
    } as CompanionEnv,
    fetcher as typeof fetch,
  );

  assert.equal(result.handled, true);
  assert.equal(result.result?.ok, false);
  assert.equal(result.result?.error, 'operator_action_not_allowed');
  assert.equal(patchedBody.includes('gptomek-command:'), false);
  assert.equal(patchedBody.includes('gptomek-result:'), true);
  assert.equal(calls.some((call) => call.includes('/actions/workflows/')), false);
});

test('accepts ordered batches and rejects nested batches', async () => {
  const batch = {
    id: 'batch-remote-1',
    op: 'batch',
    repository: 'trvny/trvny',
    steps: [
      { op: 'comment', pullRequestNumber: 176, body: 'one' },
      { op: 'react_issue_comment', commentId: 1, reaction: 'eyes' },
    ],
  };
  await assert.rejects(
    handleGptomekControl(
      target,
      { ...controlPr, body: commandMarker(batch) },
      {} as CompanionEnv,
    ),
    /invalid_gptomek_app_id/,
  );

  await assert.rejects(
    handleGptomekControl(
      target,
      {
        ...controlPr,
        body: commandMarker({
          id: 'batch-nested',
          op: 'batch',
          repository: 'trvny/trvny',
          steps: [{ op: 'batch', steps: [{ op: 'comment', pullRequestNumber: 1, body: 'nope' }] }],
        }),
      },
      {} as CompanionEnv,
    ),
    /nested_batch_not_allowed/,
  );
});

test('encodes command results in a hidden result envelope', () => {
  const marker = resultMarker({
    id: 'result-1',
    operation: 'operator_action',
    repository: 'trvny/trvny',
    ok: true,
    transport: 'issue',
    durationMs: 12,
    deduplicated: false,
    result: { id: 1 },
  });
  assert.match(marker, /^<!-- gptomek-result:[A-Za-z0-9_-]+ -->$/);
  assert.equal(marker.includes('operator_action'), false);
});
