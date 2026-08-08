import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldUpdateBranch, updateBranch } from '../src/companion-update.ts';
import type { GitHubInstallationClient } from '../src/github-app.ts';
import type { PullRequest } from '../src/companion-types.ts';

const pr: PullRequest = {
  additions: 10,
  base: { ref: 'main', sha: 'a'.repeat(40) },
  changed_files: 2,
  deletions: 2,
  draft: false,
  head: {
    ref: 'feature',
    repo: { full_name: 'trvny/trvny' },
    sha: 'b'.repeat(40),
  },
  mergeable: true,
  mergeable_state: 'clean',
  merged: false,
  number: 162,
  state: 'open',
};

const branch = { behind: 1 };
const ci = { failed: [], passed: [{}], pending: [], total: 1 };
const review = { approvals: 0, changes: 0 };

test('updates only a safe same-repository branch', () => {
  assert.equal(
    shouldUpdateBranch(pr, branch, ci, review, 'trvny/trvny', true, {}),
    true,
  );
  assert.equal(
    shouldUpdateBranch(pr, branch, ci, review, 'TRVNY/TRVNY', true, {}),
    true,
  );
  assert.equal(
    shouldUpdateBranch(
      { ...pr, head: { ...pr.head, repo: { full_name: 'someone/fork' } } },
      branch,
      ci,
      review,
      'trvny/trvny',
      true,
      {},
    ),
    false,
  );
  assert.equal(
    shouldUpdateBranch({ ...pr, draft: true }, branch, ci, review, 'trvny/trvny', true, {}),
    false,
  );
  assert.equal(
    shouldUpdateBranch({ ...pr, mergeable: false }, branch, ci, review, 'trvny/trvny', true, {}),
    false,
  );
  assert.equal(
    shouldUpdateBranch({ ...pr, mergeable_state: 'dirty' }, branch, ci, review, 'trvny/trvny', true, {}),
    false,
  );
});

test('refuses updates while CI or review is unsettled', () => {
  assert.equal(
    shouldUpdateBranch(pr, { behind: 0 }, ci, review, 'trvny/trvny', true, {}),
    false,
  );
  assert.equal(
    shouldUpdateBranch(
      pr,
      branch,
      { ...ci, pending: [{}] },
      review,
      'trvny/trvny',
      true,
      {},
    ),
    false,
  );
  assert.equal(
    shouldUpdateBranch(
      pr,
      branch,
      { ...ci, failed: [{}] },
      review,
      'trvny/trvny',
      true,
      {},
    ),
    false,
  );
  assert.equal(
    shouldUpdateBranch(
      pr,
      branch,
      { failed: [], passed: [], pending: [], total: 0 },
      review,
      'trvny/trvny',
      true,
      {},
    ),
    false,
  );
  assert.equal(
    shouldUpdateBranch(
      pr,
      branch,
      ci,
      { approvals: 0, changes: 1 },
      'trvny/trvny',
      true,
      {},
    ),
    false,
  );
});

test('recognizes common false values for the update switch', () => {
  for (const value of ['false', 'FALSE', '0', 'no', 'OFF', ' off ']) {
    assert.equal(
      shouldUpdateBranch(
        pr,
        branch,
        ci,
        review,
        'trvny/trvny',
        true,
        { KANAREK_UPDATE_BRANCH: value },
      ),
      false,
      value,
    );
  }
});

test('allows CI-less repositories only when CI is explicitly optional', () => {
  const noCi = { failed: [], passed: [], pending: [], total: 0 };
  assert.equal(
    shouldUpdateBranch(pr, branch, noCi, review, 'trvny/trvny', false, {}),
    true,
  );
});

test('uses expected_head_sha with pull-requests and contents write permissions', async () => {
  const calls: Array<{ body?: BodyInit | null; method?: string; path: string }> = [];
  const client = {
    permissions: { contents: 'write', pull_requests: 'write' },
    async json(path: string, _operation: string, init: RequestInit = {}) {
      calls.push({ body: init.body, method: init.method, path });
      return { message: 'Updating pull request branch.' };
    },
  } as unknown as GitHubInstallationClient;

  assert.equal(
    await updateBranch(client, 'trvny/trvny', 162, pr.head.sha),
    true,
  );
  assert.deepEqual(calls, [
    {
      body: JSON.stringify({ expected_head_sha: pr.head.sha }),
      method: 'PUT',
      path: '/repos/trvny/trvny/pulls/162/update-branch',
    },
  ]);
});

test('does not call update-branch without both required write permissions', async () => {
  for (const permissions of [
    { contents: 'read', pull_requests: 'write' },
    { contents: 'write', pull_requests: 'read' },
    { pull_requests: 'write' },
  ]) {
    let called = false;
    const client = {
      permissions,
      async json() {
        called = true;
        return {};
      },
    } as unknown as GitHubInstallationClient;

    assert.equal(
      await updateBranch(client, 'trvny/trvny', 162, pr.head.sha),
      false,
    );
    assert.equal(called, false);
  }
});

test('treats API and network update failures as best-effort skips', async () => {
  const client = {
    permissions: { contents: 'write', pull_requests: 'write' },
    async json() {
      throw new TypeError('network down');
    },
  } as unknown as GitHubInstallationClient;

  assert.equal(
    await updateBranch(client, 'trvny/trvny', 162, pr.head.sha),
    false,
  );
});
