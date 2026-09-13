import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { refreshCompanion } from '../src/companion.ts';
import type { CompanionEnv, CompanionTarget } from '../src/companion.ts';

const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs8', format: 'pem' })
  .toString();
const target: CompanionTarget = {
  delivery: 'behind-flow',
  installationId: 1,
  pullRequestNumber: 12,
  repository: 'trvny/trvny',
  sourceEvent: 'pull_request',
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status });

async function refresh(options: {
  behind: number;
  head: string;
  refreshedHead?: string;
  updateStatus?: number;
}): Promise<{ body: string; pullCalls: number; state: string; updateCalls: number }> {
  let body = '';
  let pullCalls = 0;
  let updateCalls = 0;
  const fetcher: typeof fetch = async (input, init = {}) => {
    const request = input instanceof Request ? input : null;
    const url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const method = (init.method ?? request?.method ?? 'GET').toUpperCase();

    if (method === 'POST' && url.pathname === '/app/installations/1/access_tokens') {
      return json({
        token: 'installation-token',
        expires_at: '2099-01-01T00:00:00Z',
        permissions: { contents: 'write', issues: 'write', pull_requests: 'write' },
      });
    }
    if (method === 'GET' && url.pathname === '/repos/trvny/trvny/pulls/12') {
      pullCalls += 1;
      const head = pullCalls > 1 ? options.refreshedHead ?? options.head : options.head;
      return json({
        additions: 1,
        auto_merge: null,
        base: { ref: 'main', sha: 'a'.repeat(40) },
        changed_files: 1,
        deletions: 0,
        draft: false,
        head: {
          ref: 'feature',
          repo: { full_name: 'trvny/trvny' },
          sha: head,
        },
        labels: [],
        mergeable: true,
        mergeable_state: 'clean',
        merged: false,
        number: 12,
        state: 'open',
        title: 'Calm branch state',
      });
    }
    if (method === 'GET' && url.pathname === '/repos/trvny/trvny/pulls/12/files') {
      return json([{ filename: 'src/example.ts' }]);
    }
    if (method === 'GET' && url.pathname.startsWith('/repos/trvny/trvny/compare/main...')) {
      return json({ behind_by: options.behind });
    }
    if (method === 'GET' && url.pathname === `/repos/trvny/trvny/commits/${options.head}/check-runs`) {
      return json({ check_runs: [{ status: 'completed', conclusion: 'success' }] });
    }
    if (method === 'GET' && url.pathname === `/repos/trvny/trvny/commits/${options.head}/status`) {
      return json({ statuses: [] });
    }
    if (method === 'GET' && url.pathname === '/repos/trvny/trvny/pulls/12/reviews') {
      return json([]);
    }
    if (method === 'GET' && url.pathname === '/repos/trvny/trvny/issues/12/comments') {
      return json([]);
    }
    if (method === 'PUT' && url.pathname === '/repos/trvny/trvny/pulls/12/update-branch') {
      updateCalls += 1;
      const status = options.updateStatus ?? 202;
      return status < 400
        ? json({ message: 'Updating pull request branch.' }, status)
        : json({ message: 'Update rejected.' }, status);
    }
    if (method === 'POST' && url.pathname === '/repos/trvny/trvny/issues/12/comments') {
      const raw = typeof init.body === 'string' ? init.body : '';
      body = String((JSON.parse(raw) as { body?: unknown }).body ?? '');
      return json({ id: 123 });
    }
    if (method === 'GET' && url.pathname === '/repos/trvny/trvny/issues/12/reactions') {
      return json([]);
    }
    if (method === 'POST' && url.pathname === '/repos/trvny/trvny/issues/12/reactions') {
      return json({ id: 456 });
    }
    return new Response(`unexpected ${method} ${url.pathname}`, { status: 500 });
  };

  const result = await refreshCompanion(
    target,
    {
      GITHUB_APP_ID: '4472094',
      GITHUB_APP_SLUG: 'kanarek-companion',
      GITHUB_PRIVATE_KEY: privateKey,
      KANAREK_AI_ENABLED: 'false',
      KANAREK_REQUIRE_CI: 'true',
    } as CompanionEnv,
    fetcher,
  );
  return { body, pullCalls, state: result.state, updateCalls };
}

test('accepted auto-update stays waiting until the new head refreshes', async () => {
  const oldHead = 'b'.repeat(40);
  const accepted = await refresh({ behind: 2, head: oldHead });
  assert.equal(accepted.updateCalls, 1);
  assert.equal(accepted.state, 'waiting');
  assert.match(accepted.body, /Kanarek · 🟡 waiting/);

  const refreshed = await refresh({ behind: 0, head: 'c'.repeat(40) });
  assert.equal(refreshed.updateCalls, 0);
  assert.equal(refreshed.state, 'ready');
  assert.match(refreshed.body, /Kanarek · 🟢 ready/);
});

test('rejected auto-update with an unchanged head leaves behind state informational', async () => {
  const rejected = await refresh({
    behind: 2,
    head: 'd'.repeat(40),
    updateStatus: 422,
  });
  assert.equal(rejected.updateCalls, 1);
  assert.equal(rejected.pullCalls, 2);
  assert.equal(rejected.state, 'ready');
  assert.match(rejected.body, /Kanarek · 🟢 ready/);
  assert.match(rejected.body, /`main` ↓/);
});

test('stale-head rejection waits until the pushed head is refreshed', async () => {
  const oldHead = 'd'.repeat(40);
  const newHead = 'e'.repeat(40);
  const stale = await refresh({
    behind: 2,
    head: oldHead,
    refreshedHead: newHead,
    updateStatus: 422,
  });
  assert.equal(stale.updateCalls, 1);
  assert.equal(stale.pullCalls, 2);
  assert.equal(stale.state, 'waiting');
  assert.match(stale.body, /Kanarek · 🟡 waiting/);

  const refreshed = await refresh({ behind: 0, head: newHead });
  assert.equal(refreshed.state, 'ready');
  assert.match(refreshed.body, /Kanarek · 🟢 ready/);
});
