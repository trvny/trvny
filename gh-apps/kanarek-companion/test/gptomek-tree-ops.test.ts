import assert from 'node:assert/strict';
import test from 'node:test';

import {
  commitTree,
  gptomekMailboxFailureIsTerminal,
  moveFiles,
} from '../src/gptomek.ts';
import {
  GitHubApiError,
  type GitHubInstallationClient,
} from '../src/github-app.ts';

function body(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

test('commit_tree reuses Git objects for mode and structural changes', async () => {
  const expected = '1'.repeat(40);
  const baseTree = '2'.repeat(40);
  const createdTree = '3'.repeat(40);
  const createdCommit = '4'.repeat(40);
  const oldBlob = 'a'.repeat(40);
  const scriptBlob = 'b'.repeat(40);
  const replacementBlob = 'c'.repeat(40);
  let headReads = 0;

  const client = {
    async json<T>(_path: string, operation: string, init?: RequestInit): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        headReads += 1;
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        return { tree: { sha: baseTree }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_commit_tree') {
        return {
          truncated: false,
          tree: [
            { path: 'dir', mode: '040000', type: 'tree', sha: 'd'.repeat(40) },
            { path: 'dir/old.bin', mode: '100644', type: 'blob', sha: oldBlob },
            { path: 'script.sh', mode: '100644', type: 'blob', sha: scriptBlob },
            { path: 'untouched.txt', mode: '100644', type: 'blob', sha: 'e'.repeat(40) },
          ],
        } as T;
      }
      if (operation === 'gptomek_create_tree') {
        const value = body(init);
        assert.equal(value.base_tree, baseTree);
        assert.deepEqual(value.tree, [
          { path: 'dir', mode: '100644', type: 'blob', sha: replacementBlob },
          { path: 'dir/old.bin', mode: '100644', type: 'blob', sha: null },
          { path: 'script.sh', mode: '100755', type: 'blob', sha: scriptBlob },
        ]);
        return { sha: createdTree } as T;
      }
      if (operation === 'gptomek_create_commit') {
        const value = body(init);
        assert.equal(value.message, 'feat: tree mutation');
        assert.equal(value.tree, createdTree);
        assert.deepEqual(value.parents, [expected]);
        return { sha: createdCommit } as T;
      }
      if (operation === 'gptomek_update_branch') {
        assert.deepEqual(body(init), { sha: createdCommit, force: false });
        return {} as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  const result = await commitTree(client, {
    id: 'tree-1',
    op: 'commit_tree',
    repository: 'trvny/trvny',
    branch: 'feat/target',
    expectedHeadSha: expected,
    message: 'feat: tree mutation',
    entries: [
      { path: 'dir/old.bin', sha: null },
      { path: 'dir', sha: replacementBlob, mode: '100644' },
      { path: 'script.sh', sha: scriptBlob, mode: '100755' },
    ],
  });

  assert.deepEqual(result, { sha: createdCommit, entries: 3 });
  assert.equal(headReads, 2);
});

test('commit_tree requires a mode for new objects and rejects final path conflicts', async () => {
  const expected = '1'.repeat(40);
  const baseTree = '2'.repeat(40);

  function clientFor(entries: Array<Record<string, unknown>>): GitHubInstallationClient {
    return {
      async json<T>(_path: string, operation: string): Promise<T> {
        if (operation === 'gptomek_get_branch_ref') {
          return { object: { sha: expected } } as T;
        }
        if (operation === 'gptomek_get_commit') {
          return { tree: { sha: baseTree }, parents: [] } as T;
        }
        if (operation === 'gptomek_get_commit_tree') {
          return { truncated: false, tree: entries } as T;
        }
        throw new Error(`unexpected:${operation}`);
      },
    } as unknown as GitHubInstallationClient;
  }

  await assert.rejects(
    commitTree(clientFor([]), {
      id: 'tree-new-no-mode',
      op: 'commit_tree',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      message: 'test',
      entries: [{ path: 'new.bin', sha: 'a'.repeat(40) }],
    }),
    /commit_tree_mode_required/,
  );

  await assert.rejects(
    commitTree(clientFor([
      { path: 'dir', mode: '040000', type: 'tree', sha: 'b'.repeat(40) },
      { path: 'dir/keep.txt', mode: '100644', type: 'blob', sha: 'c'.repeat(40) },
    ]), {
      id: 'tree-path-conflict',
      op: 'commit_tree',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      message: 'test',
      entries: [{ path: 'dir', sha: 'd'.repeat(40), mode: '100644' }],
    }),
    /commit_tree_path_conflict/,
  );
});

test('commit_tree keeps GitHub 422 tree responses retryable', async () => {
  const expected = '1'.repeat(40);
  const baseTree = '2'.repeat(40);

  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        return { tree: { sha: baseTree }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_commit_tree') {
        return { truncated: false, tree: [] } as T;
      }
      if (operation === 'gptomek_create_tree') {
        throw new GitHubApiError(operation, 422);
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    commitTree(client, {
      id: 'tree-api-422',
      op: 'commit_tree',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      message: 'test',
      entries: [{ path: 'new.bin', sha: 'a'.repeat(40), mode: '100644' }],
    }),
    (error: unknown) => error instanceof GitHubApiError && error.status === 422,
  );
  assert.equal(
    gptomekMailboxFailureIsTerminal('commit_tree', 'gptomek_create_tree:422'),
    false,
  );
});

test('move_files atomically swaps paths while preserving SHA and mode', async () => {
  const expected = '1'.repeat(40);
  const baseTree = '2'.repeat(40);
  const createdTree = '3'.repeat(40);
  const createdCommit = '4'.repeat(40);
  const aBlob = 'a'.repeat(40);
  const bBlob = 'b'.repeat(40);
  let headReads = 0;

  const client = {
    async json<T>(_path: string, operation: string, init?: RequestInit): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        headReads += 1;
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        return { tree: { sha: baseTree }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_move_tree') {
        return {
          truncated: false,
          tree: [
            { path: 'a.bin', mode: '100644', type: 'blob', sha: aBlob },
            { path: 'b.bin', mode: '100755', type: 'blob', sha: bBlob },
            { path: 'keep.txt', mode: '100644', type: 'blob', sha: 'c'.repeat(40) },
          ],
        } as T;
      }
      if (operation === 'gptomek_create_tree') {
        const value = body(init);
        assert.equal(value.base_tree, baseTree);
        assert.deepEqual(value.tree, [
          { path: 'a.bin', mode: '100755', type: 'blob', sha: bBlob },
          { path: 'b.bin', mode: '100644', type: 'blob', sha: aBlob },
        ]);
        return { sha: createdTree } as T;
      }
      if (operation === 'gptomek_create_commit') {
        const value = body(init);
        assert.equal(value.message, 'refactor: swap binaries');
        assert.equal(value.tree, createdTree);
        assert.deepEqual(value.parents, [expected]);
        return { sha: createdCommit } as T;
      }
      if (operation === 'gptomek_update_branch') {
        assert.deepEqual(body(init), { sha: createdCommit, force: false });
        return {} as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  const result = await moveFiles(client, {
    id: 'move-swap',
    op: 'move_files',
    repository: 'trvny/trvny',
    branch: 'feat/target',
    expectedHeadSha: expected,
    message: 'refactor: swap binaries',
    moves: [
      { from: 'a.bin', to: 'b.bin' },
      { from: 'b.bin', to: 'a.bin' },
    ],
  });

  assert.deepEqual(result, { sha: createdCommit, moved: 2, entries: 2 });
  assert.equal(headReads, 2);
});

test('move_files rejects occupied targets and file-directory collisions', async () => {
  const expected = '1'.repeat(40);
  const baseTree = '2'.repeat(40);

  function clientFor(entries: Array<Record<string, unknown>>): GitHubInstallationClient {
    return {
      async json<T>(_path: string, operation: string): Promise<T> {
        if (operation === 'gptomek_get_branch_ref') {
          return { object: { sha: expected } } as T;
        }
        if (operation === 'gptomek_get_commit') {
          return { tree: { sha: baseTree }, parents: [] } as T;
        }
        if (operation === 'gptomek_get_move_tree') {
          return { truncated: false, tree: entries } as T;
        }
        throw new Error(`unexpected:${operation}`);
      },
    } as unknown as GitHubInstallationClient;
  }

  const source = { path: 'source.bin', mode: '100644', type: 'blob', sha: 'a'.repeat(40) };

  await assert.rejects(
    moveFiles(clientFor([
      source,
      { path: 'taken.bin', mode: '100644', type: 'blob', sha: 'b'.repeat(40) },
    ]), {
      id: 'move-taken',
      op: 'move_files',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      message: 'test',
      moves: [{ from: 'source.bin', to: 'taken.bin' }],
    }),
    /move_files_target_exists/,
  );

  await assert.rejects(
    moveFiles(clientFor([
      source,
      { path: 'dir', mode: '040000', type: 'tree', sha: 'c'.repeat(40) },
      { path: 'dir/keep.txt', mode: '100644', type: 'blob', sha: 'd'.repeat(40) },
    ]), {
      id: 'move-dir-conflict',
      op: 'move_files',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      message: 'test',
      moves: [{ from: 'source.bin', to: 'dir' }],
    }),
    /move_files_path_conflict/,
  );
});

test('tree operation validation failures are terminal mailbox results', () => {
  assert.equal(
    gptomekMailboxFailureIsTerminal('commit_tree', 'commit_tree_path_conflict'),
    true,
  );
  assert.equal(
    gptomekMailboxFailureIsTerminal('move_files', 'move_files_target_exists'),
    true,
  );
  assert.equal(
    gptomekMailboxFailureIsTerminal('move_files', 'branch_head_changed'),
    true,
  );
});
