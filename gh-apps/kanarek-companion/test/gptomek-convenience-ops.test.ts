import assert from 'node:assert/strict';
import test from 'node:test';

import {
  branchFromPatch,
  commandMarker,
  gptomekMailboxFailureIsTerminal,
  gptomekReplayCommentSearchPath,
  handleGptomekMailboxCommand,
  reviewFix,
} from '../src/gptomek.ts';
import {
  GitHubApiError,
  type GitHubInstallationClient,
} from '../src/github-app.ts';

function body(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

test('branch_from_patch creates a bot commit before creating the branch ref', async () => {
  const baseSha = '1'.repeat(40);
  const baseTree = '2'.repeat(40);
  const blobSha = '3'.repeat(40);
  const treeSha = '4'.repeat(40);
  const commitSha = '5'.repeat(40);
  const calls: string[] = [];

  const client = {
    async json<T>(_path: string, operation: string, init?: RequestInit): Promise<T> {
      calls.push(operation);
      if (operation === 'gptomek_get_repository') {
        return { default_branch: 'main' } as T;
      }
      if (operation === 'gptomek_get_branch_ref') {
        throw new GitHubApiError(operation, 404);
      }
      if (operation === 'gptomek_get_commit') {
        return { tree: { sha: baseTree }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_patch_tree') {
        return { truncated: false, tree: [] } as T;
      }
      if (operation === 'gptomek_get_patch_file') {
        throw new GitHubApiError(operation, 404);
      }
      if (operation === 'gptomek_create_blob') {
        assert.equal(body(init).content, 'hello\n');
        return { sha: blobSha } as T;
      }
      if (operation === 'gptomek_create_tree') {
        const value = body(init);
        assert.equal(value.base_tree, baseTree);
        assert.deepEqual(value.tree, [
          {
            path: 'hello.txt',
            mode: '100644',
            type: 'blob',
            sha: blobSha,
          },
        ]);
        return { sha: treeSha } as T;
      }
      if (operation === 'gptomek_create_commit') {
        const value = body(init);
        assert.equal(value.tree, treeSha);
        assert.deepEqual(value.parents, [baseSha]);
        return { sha: commitSha } as T;
      }
      if (operation === 'gptomek_create_branch_ref') {
        assert.deepEqual(body(init), {
          ref: 'refs/heads/feat/from-patch',
          sha: commitSha,
        });
        return {} as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  const result = await branchFromPatch(client, {
    id: 'branch-patch-1',
    op: 'branch_from_patch',
    repository: 'trvny/trvny',
    branch: 'feat/from-patch',
    baseSha,
    message: 'feat: branch from patch',
    patch: [
      'diff --git a/hello.txt b/hello.txt',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/hello.txt',
      '@@ -0,0 +1 @@',
      '+hello',
      '',
    ].join('\n'),
  });

  assert.deepEqual(result, {
    branch: 'feat/from-patch',
    sha: commitSha,
    baseSha,
    files: 1,
  });
  assert.ok(
    calls.indexOf('gptomek_create_commit') <
      calls.indexOf('gptomek_create_branch_ref'),
  );
});

test('branch_from_patch refuses an existing or protected branch', async () => {
  const existing = '1'.repeat(40);
  const existingClient = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_repository') {
        return { default_branch: 'main' } as T;
      }
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: existing } } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    branchFromPatch(existingClient, {
      id: 'branch-existing',
      op: 'branch_from_patch',
      repository: 'trvny/trvny',
      branch: 'feat/existing',
      baseSha: '2'.repeat(40),
      message: 'test',
      patch: '--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+a\n',
    }),
    /branch_from_patch_branch_exists/,
  );

  const protectedClient = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_repository') {
        return { default_branch: 'develop' } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    branchFromPatch(protectedClient, {
      id: 'branch-protected',
      op: 'branch_from_patch',
      repository: 'trvny/trvny',
      branch: 'main',
      baseSha: '2'.repeat(40),
      message: 'test',
      patch: '--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+a\n',
    }),
    /protected_branch/,
  );
});

test('branch_from_patch rejects Git-invalid ref names before any API write', async () => {
  const marker = commandMarker({
    id: 'branch-invalid-ref',
    op: 'branch_from_patch',
    repository: 'trvny/trvny',
    branch: 'feat/.hidden',
    baseSha: '1'.repeat(40),
    message: 'test',
    patch: '--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+a\n',
  });

  await assert.rejects(
    handleGptomekMailboxCommand(
      marker,
      '/repos/trvny/trvny/issues/203',
      {} as never,
    ),
    /invalid_branch/,
  );
});

test('review_fix paginates, resumes safely and rechecks the PR head', async () => {
  const expected = '1'.repeat(40);
  const patched = '2'.repeat(40);
  const steps: Array<Record<string, unknown>> = [];
  let pullReads = 0;
  let verifyReads = 0;
  let threadReads = 0;
  let threadResolved = false;

  const client = {
    async json<T>(_path: string, operation: string, init?: RequestInit): Promise<T> {
      if (
        operation === 'gptomek_get_review_fix_pr' ||
        operation === 'gptomek_get_review_fix_pr_after_patch'
      ) {
        pullReads += 1;
        return {
          head: {
            ref: 'feat/fix',
            sha: pullReads < 3 ? expected : patched,
            repo: { full_name: 'trvny/trvny' },
          },
        } as T;
      }
      if (operation === 'gptomek_verify_review_fix_head') {
        verifyReads += 1;
        return {
          head: {
            ref: 'feat/fix',
            sha: patched,
            repo: { full_name: 'trvny/trvny' },
          },
        } as T;
      }
      if (operation === 'gptomek_get_review_fix_comment') {
        return {
          pull_request_url: 'https://api.github.com/repos/trvny/trvny/pulls/123',
        } as T;
      }
      if (operation === 'gptomek_get_review_fix_thread') {
        threadReads += 1;
        const variables = body(init).variables as Record<string, unknown>;
        if (threadReads === 1) {
          assert.equal(variables.after, null);
          return {
            data: {
              node: {
                __typename: 'PullRequestReviewThread',
                id: 'PRRT_test',
                isResolved: false,
                viewerCanResolve: true,
                pullRequest: {
                  number: 123,
                  repository: { nameWithOwner: 'trvny/trvny' },
                },
                comments: {
                  nodes: [{ databaseId: 111 }],
                  pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
                },
              },
            },
          } as T;
        }
        if (threadReads === 2) assert.equal(variables.after, 'cursor-1');
        return {
          data: {
            node: {
              __typename: 'PullRequestReviewThread',
              id: 'PRRT_test',
              isResolved: threadResolved,
              viewerCanResolve: true,
              pullRequest: {
                number: 123,
                repository: { nameWithOwner: 'trvny/trvny' },
              },
              comments: {
                nodes: [{ databaseId: 456 }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        } as T;
      }
      if (operation === 'gptomek_resolve_review_thread') {
        const value = body(init);
        assert.equal(
          (value.variables as Record<string, unknown>).threadId,
          'PRRT_test',
        );
        threadResolved = true;
        return {
          data: {
            resolveReviewThread: {
              thread: { id: 'PRRT_test', isResolved: true },
            },
          },
        } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  const executor = async (step: Record<string, unknown>) => {
    steps.push(step);
    if (step.op === 'apply_patch') {
      return { result: { sha: patched, files: 1 }, deduplicated: true };
    }
    return { result: { ok: true }, deduplicated: false };
  };

  const result = await reviewFix(
    client,
    {
      id: 'review-fix-1',
      op: 'review_fix',
      repository: 'trvny/Trvny',
      pullRequestNumber: 123,
      branch: 'feat/fix',
      expectedHeadSha: expected,
      commentId: 456,
      reviewThreadId: 'PRRT_test',
      message: 'fix: address review',
      patch: '--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n',
    },
    {} as never,
    executor as never,
  );

  assert.equal(steps.length, 3);
  assert.equal(steps[0].op, 'apply_patch');
  assert.equal(steps[0].id, 'internal:review-fix-1:review-fix:patch');
  assert.equal(steps[1].op, 'reply_review');
  assert.equal(steps[1].id, 'internal:review-fix-1:review-fix:reply');
  assert.equal(steps[1].body, `Fixed in ${patched.slice(0, 12)}.`);
  assert.equal(steps[2].op, 'react_review_comment');
  assert.equal(steps[2].id, 'internal:review-fix-1:review-fix:react');
  assert.equal(steps[2].reaction, '+1');
  assert.deepEqual(result, {
    sha: patched,
    patchDeduplicated: true,
    replyDeduplicated: false,
    reactionDeduplicated: false,
    resolved: true,
  });
  assert.equal(threadResolved, true);
  assert.equal(pullReads, 3);
  assert.equal(verifyReads, 3);
  assert.equal(threadReads, 3);
});

test('review_fix validates the review thread before running any write step', async () => {
  let executed = false;
  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_review_fix_pr') {
        return {
          head: {
            ref: 'feat/fix',
            sha: '1'.repeat(40),
            repo: { full_name: 'trvny/trvny' },
          },
        } as T;
      }
      if (operation === 'gptomek_get_review_fix_comment') {
        return {
          pull_request_url: 'https://api.github.com/repos/trvny/trvny/pulls/123',
        } as T;
      }
      if (operation === 'gptomek_get_review_fix_thread') {
        return {
          data: {
            node: {
              __typename: 'PullRequestReviewThread',
              id: 'PRRT_wrong',
              isResolved: false,
              viewerCanResolve: true,
              pullRequest: {
                number: 123,
                repository: { nameWithOwner: 'trvny/trvny' },
              },
              comments: {
                nodes: [{ databaseId: 456 }],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    reviewFix(
      client,
      {
        id: 'review-fix-bad-thread',
        op: 'review_fix',
        repository: 'trvny/trvny',
        pullRequestNumber: 123,
        branch: 'feat/fix',
        expectedHeadSha: '1'.repeat(40),
        commentId: 456,
        reviewThreadId: 'PRRT_test',
        message: 'fix: review',
        patch: '--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n',
      },
      {} as never,
      (async () => {
        executed = true;
        return { result: {}, deduplicated: false };
      }) as never,
    ),
    /review_fix_thread_mismatch/,
  );
  assert.equal(executed, false);
});

test('review_fix validates comment ownership before running any write step', async () => {
  let executed = false;
  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_review_fix_pr') {
        return {
          head: {
            ref: 'feat/fix',
            sha: '1'.repeat(40),
            repo: { full_name: 'trvny/trvny' },
          },
        } as T;
      }
      if (operation === 'gptomek_get_review_fix_comment') {
        return {
          pull_request_url: 'https://api.github.com/repos/trvny/trvny/pulls/999',
        } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    reviewFix(
      client,
      {
        id: 'review-fix-bad-comment',
        op: 'review_fix',
        repository: 'trvny/trvny',
        pullRequestNumber: 123,
        branch: 'feat/fix',
        expectedHeadSha: '1'.repeat(40),
        commentId: 456,
        message: 'fix: review',
        patch: '--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n',
      },
      {} as never,
      (async () => {
        executed = true;
        return { result: {}, deduplicated: false };
      }) as never,
    ),
    /review_fix_comment_mismatch/,
  );
  assert.equal(executed, false);
});

test('review reply replay lookup searches newest comments first', () => {
  assert.equal(
    gptomekReplayCommentSearchPath(
      '/repos/trvny/trvny/pulls/123/comments',
    ),
    '/repos/trvny/trvny/pulls/123/comments?sort=created&direction=desc',
  );
  assert.equal(
    gptomekReplayCommentSearchPath(
      '/repos/trvny/trvny/issues/123/comments',
    ),
    '/repos/trvny/trvny/issues/123/comments',
  );
});

test('new convenience command validation failures are terminal mailbox results', () => {
  assert.equal(
    gptomekMailboxFailureIsTerminal(
      'branch_from_patch',
      'branch_from_patch_branch_exists',
    ),
    true,
  );
  assert.equal(
    gptomekMailboxFailureIsTerminal(
      'branch_from_patch',
      'patch_context_mismatch',
    ),
    true,
  );
  assert.equal(
    gptomekMailboxFailureIsTerminal(
      'review_fix',
      'review_fix_comment_mismatch',
    ),
    true,
  );
  assert.equal(
    gptomekMailboxFailureIsTerminal(
      'review_fix',
      'patch_context_mismatch',
    ),
    true,
  );
  assert.equal(
    gptomekMailboxFailureIsTerminal(
      'review_fix',
      'review_fix_thread_resolve_not_applied',
    ),
    false,
  );
});
