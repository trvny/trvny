import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commandMarker,
  deleteBranch,
  handleGptomekControl,
  isGptomekControlPr,
  isProtectedBranch,
} from '../src/gptomek.ts';
import {
  GitHubApiError,
  type GitHubInstallationClient,
} from '../src/github-app.ts';
import type { CompanionEnv, CompanionTarget, PullRequest } from '../src/companion-types.ts';

const target: CompanionTarget = {
  delivery: 'delivery-1',
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
    ref: 'historical-head-name',
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

test('recognizes only trvny/trvny#176 as the GPTomek control PR', () => {
  assert.equal(isGptomekControlPr(target, controlPr), true);
  assert.equal(
    isGptomekControlPr(
      { ...target, pullRequestNumber: 999 },
      controlPr,
    ),
    false,
  );
  assert.equal(
    isGptomekControlPr(
      { ...target, repository: 'trvny/feeds' },
      controlPr,
    ),
    false,
  );
  assert.equal(
    isGptomekControlPr(target, { ...controlPr, user: { login: 'someone' } }),
    false,
  );
});

test('keeps an idle control PR out of normal Kanarek handling', async () => {
  const result = await handleGptomekControl(
    target,
    controlPr,
    {} as CompanionEnv,
  );
  assert.deepEqual(result, { control: true, handled: false });
});

test('encodes commands in a single hidden marker', () => {
  const marker = commandMarker({
    id: 'test-1',
    op: 'comment',
    repository: 'trvny/feeds',
    pullRequestNumber: 12,
    body: 'hello',
  });
  assert.match(marker, /^<!-- gptomek-command:[A-Za-z0-9_-]+ -->$/);
  assert.equal(marker.includes('hello'), false);
});

test('protects main, the default branch, and GPTomek control transport', () => {
  assert.equal(isProtectedBranch('main', 'develop'), true);
  assert.equal(isProtectedBranch('MAIN', 'develop'), true);
  assert.equal(isProtectedBranch('develop', 'develop'), true);
  assert.equal(isProtectedBranch('gptomek/control', 'main'), true);
  assert.equal(isProtectedBranch('feature/delete-me', 'main'), false);
});

test('deletes only a branch still pointing at the expected head', async () => {
  const expectedHeadSha = 'c'.repeat(40);
  const calls: Array<{ method?: string; operation: string; path: string }> = [];
  const client = {
    async json<T>(path: string, operation: string): Promise<T> {
      calls.push({ operation, path });
      if (operation === 'gptomek_get_repository') {
        return { default_branch: 'main' } as T;
      }
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expectedHeadSha } } as T;
      }
      throw new Error(`unexpected_json:${operation}`);
    },
    async void(
      path: string,
      operation: string,
      init: RequestInit = {},
    ): Promise<void> {
      calls.push({ method: init.method, operation, path });
    },
  } as unknown as GitHubInstallationClient;

  await deleteBranch(client, {
    id: 'delete-1',
    op: 'delete_branch',
    repository: 'trvny/trvny',
    branch: 'feature/delete-me',
    expectedHeadSha,
  });

  assert.deepEqual(calls, [
    {
      operation: 'gptomek_get_repository',
      path: '/repos/trvny/trvny',
    },
    {
      operation: 'gptomek_get_branch_ref',
      path: '/repos/trvny/trvny/git/ref/heads/feature%2Fdelete-me',
    },
    {
      method: 'DELETE',
      operation: 'gptomek_delete_branch',
      path: '/repos/trvny/trvny/git/refs/heads/feature%2Fdelete-me',
    },
  ]);
});

test('treats an already missing branch as a successful retry', async () => {
  let deleted = false;
  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_repository') {
        return { default_branch: 'main' } as T;
      }
      if (operation === 'gptomek_get_branch_ref') {
        throw new GitHubApiError(operation, 404);
      }
      throw new Error(`unexpected_json:${operation}`);
    },
    async void(): Promise<void> {
      deleted = true;
    },
  } as unknown as GitHubInstallationClient;

  await deleteBranch(client, {
    id: 'delete-retry',
    op: 'delete_branch',
    repository: 'trvny/trvny',
    branch: 'feature/already-gone',
    expectedHeadSha: 'c'.repeat(40),
  });

  assert.equal(deleted, false);
});

test('refuses deletion after the branch head changes', async () => {
  let deleted = false;
  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_repository') {
        return { default_branch: 'main' } as T;
      }
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: 'd'.repeat(40) } } as T;
      }
      throw new Error(`unexpected_json:${operation}`);
    },
    async void(): Promise<void> {
      deleted = true;
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    deleteBranch(client, {
      id: 'delete-2',
      op: 'delete_branch',
      repository: 'trvny/trvny',
      branch: 'feature/delete-me',
      expectedHeadSha: 'c'.repeat(40),
    }),
    /branch_head_changed/,
  );
  assert.equal(deleted, false);
});

test('rejects protected branches before reading their head', async () => {
  let headRead = false;
  let deleted = false;
  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_repository') {
        return { default_branch: 'develop' } as T;
      }
      if (operation === 'gptomek_get_branch_ref') headRead = true;
      throw new Error(`unexpected_json:${operation}`);
    },
    async void(): Promise<void> {
      deleted = true;
    },
  } as unknown as GitHubInstallationClient;

  for (const branch of ['main', 'develop', 'gptomek/control']) {
    await assert.rejects(
      deleteBranch(client, {
        id: `delete-${branch}`,
        op: 'delete_branch',
        repository: 'trvny/trvny',
        branch,
        expectedHeadSha: 'c'.repeat(40),
      }),
      /protected_branch/,
    );
  }
  assert.equal(headRead, false);
  assert.equal(deleted, false);
});
