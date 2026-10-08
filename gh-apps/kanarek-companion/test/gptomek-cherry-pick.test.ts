import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cherryPick,
  gptomekMailboxFailureIsTerminal,
} from '../src/gptomek.ts';
import type { GitHubInstallationClient } from '../src/github-app.ts';

function body(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

test('cherry_pick reapplies a strict single-parent tree delta without copying blobs', async () => {
  const expected = '1'.repeat(40);
  const sourceSha = '2'.repeat(40);
  const parentSha = '3'.repeat(40);
  const targetTree = '4'.repeat(40);
  const parentTree = '5'.repeat(40);
  const sourceTree = '6'.repeat(40);
  const newTree = '7'.repeat(40);
  const newCommit = '8'.repeat(40);
  const oldBlob = 'a'.repeat(40);
  const newBlob = 'b'.repeat(40);
  const renamedBlob = 'c'.repeat(40);
  const linkBlob = 'd'.repeat(40);
  const unrelatedBlob = 'e'.repeat(40);
  let commitReads = 0;

  const client = {
    async json<T>(_path: string, operation: string, init?: RequestInit): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }

      if (operation === 'gptomek_get_commit') {
        commitReads += 1;
        if (commitReads === 1) {
          return {
            message: 'fix: source change',
            tree: { sha: sourceTree },
            parents: [{ sha: parentSha }],
          } as T;
        }
        if (commitReads === 2) {
          return { message: 'parent', tree: { sha: parentTree }, parents: [] } as T;
        }
        if (commitReads === 3) {
          return { message: 'target', tree: { sha: targetTree }, parents: [] } as T;
        }
        throw new Error('unexpected_commit_read');
      }

      if (operation === 'gptomek_get_cherry_parent_tree') {
        return {
          truncated: false,
          tree: [
            { path: 'old.txt', mode: '100644', type: 'blob', sha: oldBlob },
            { path: 'rename-old.bin', mode: '100644', type: 'blob', sha: renamedBlob },
          ],
        } as T;
      }

      if (operation === 'gptomek_get_cherry_source_tree') {
        return {
          truncated: false,
          tree: [
            { path: 'old.txt', mode: '100755', type: 'blob', sha: newBlob },
            { path: 'rename-new.bin', mode: '100644', type: 'blob', sha: renamedBlob },
            { path: 'added.link', mode: '120000', type: 'blob', sha: linkBlob },
          ],
        } as T;
      }

      if (operation === 'gptomek_get_cherry_target_tree') {
        return {
          truncated: false,
          tree: [
            { path: 'old.txt', mode: '100644', type: 'blob', sha: oldBlob },
            { path: 'rename-old.bin', mode: '100644', type: 'blob', sha: renamedBlob },
            { path: 'unrelated.txt', mode: '100644', type: 'blob', sha: unrelatedBlob },
          ],
        } as T;
      }

      if (operation === 'gptomek_create_tree') {
        const value = body(init);
        assert.equal(value.base_tree, targetTree);
        assert.deepEqual(value.tree, [
          {
            path: 'added.link',
            mode: '120000',
            type: 'blob',
            sha: linkBlob,
          },
          {
            path: 'old.txt',
            mode: '100755',
            type: 'blob',
            sha: newBlob,
          },
          {
            path: 'rename-new.bin',
            mode: '100644',
            type: 'blob',
            sha: renamedBlob,
          },
          {
            path: 'rename-old.bin',
            mode: '100644',
            type: 'blob',
            sha: null,
          },
        ]);
        return { sha: newTree } as T;
      }

      if (operation === 'gptomek_create_commit') {
        const value = body(init);
        assert.equal(value.message, 'fix: source change');
        assert.equal(value.tree, newTree);
        assert.deepEqual(value.parents, [expected]);
        return { sha: newCommit } as T;
      }

      if (operation === 'gptomek_update_branch') {
        assert.deepEqual(body(init), { sha: newCommit, force: false });
        return {} as T;
      }

      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  const result = await cherryPick(client, {
    id: 'cherry-pick-1',
    op: 'cherry_pick',
    repository: 'trvny/trvny',
    branch: 'feat/target',
    expectedHeadSha: expected,
    commitSha: sourceSha,
  });

  assert.deepEqual(result, {
    sha: newCommit,
    cherryPicked: sourceSha,
    files: 4,
  });
});

test('cherry_pick rejects overlapping target changes instead of merging them', async () => {
  const expected = '1'.repeat(40);
  const sourceSha = '2'.repeat(40);
  const parentSha = '3'.repeat(40);
  let commitReads = 0;

  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        commitReads += 1;
        if (commitReads === 1) {
          return {
            message: 'source',
            tree: { sha: '4'.repeat(40) },
            parents: [{ sha: parentSha }],
          } as T;
        }
        if (commitReads === 2) {
          return { tree: { sha: '5'.repeat(40) }, parents: [] } as T;
        }
        return { tree: { sha: '6'.repeat(40) }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_cherry_parent_tree') {
        return {
          truncated: false,
          tree: [{ path: 'same.txt', mode: '100644', type: 'blob', sha: 'a'.repeat(40) }],
        } as T;
      }
      if (operation === 'gptomek_get_cherry_source_tree') {
        return {
          truncated: false,
          tree: [{ path: 'same.txt', mode: '100644', type: 'blob', sha: 'b'.repeat(40) }],
        } as T;
      }
      if (operation === 'gptomek_get_cherry_target_tree') {
        return {
          truncated: false,
          tree: [{ path: 'same.txt', mode: '100644', type: 'blob', sha: 'c'.repeat(40) }],
        } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    cherryPick(client, {
      id: 'cherry-conflict',
      op: 'cherry_pick',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      commitSha: sourceSha,
    }),
    /cherry_pick_conflict/,
  );
});

test('cherry_pick refuses merge commits and file-directory shape changes', async () => {
  const expected = '1'.repeat(40);

  const mergeClient = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        return {
          message: 'merge',
          tree: { sha: '2'.repeat(40) },
          parents: [{ sha: '3'.repeat(40) }, { sha: '4'.repeat(40) }],
        } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    cherryPick(mergeClient, {
      id: 'cherry-merge',
      op: 'cherry_pick',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      commitSha: '5'.repeat(40),
    }),
    /cherry_pick_merge_commit_not_supported/,
  );

  let reads = 0;
  const structuralClient = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        reads += 1;
        if (reads === 1) {
          return {
            message: 'file to dir',
            tree: { sha: '6'.repeat(40) },
            parents: [{ sha: '7'.repeat(40) }],
          } as T;
        }
        if (reads === 2) return { tree: { sha: '8'.repeat(40) }, parents: [] } as T;
        return { tree: { sha: '9'.repeat(40) }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_cherry_parent_tree') {
        return {
          truncated: false,
          tree: [{ path: 'node', mode: '100644', type: 'blob', sha: 'a'.repeat(40) }],
        } as T;
      }
      if (operation === 'gptomek_get_cherry_source_tree') {
        return {
          truncated: false,
          tree: [
            { path: 'node', mode: '040000', type: 'tree', sha: 'b'.repeat(40) },
            { path: 'node/file.txt', mode: '100644', type: 'blob', sha: 'c'.repeat(40) },
          ],
        } as T;
      }
      if (operation === 'gptomek_get_cherry_target_tree') {
        return {
          truncated: false,
          tree: [{ path: 'node', mode: '100644', type: 'blob', sha: 'a'.repeat(40) }],
        } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    cherryPick(structuralClient, {
      id: 'cherry-structural',
      op: 'cherry_pick',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      commitSha: 'd'.repeat(40),
    }),
    /cherry_pick_structural_change_not_supported/,
  );
});

test('cherry_pick rejects malformed tree responses before deriving changes', async () => {
  const expected = '1'.repeat(40);
  let reads = 0;

  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        reads += 1;
        if (reads === 1) {
          return {
            message: 'source',
            tree: { sha: '2'.repeat(40) },
            parents: [{ sha: '3'.repeat(40) }],
          } as T;
        }
        if (reads === 2) return { tree: { sha: '4'.repeat(40) }, parents: [] } as T;
        return { tree: { sha: '5'.repeat(40) }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_cherry_parent_tree') {
        return {
          truncated: false,
          tree: [{ path: 'keep.txt', mode: '100644', type: 'blob', sha: 'a'.repeat(40) }],
        } as T;
      }
      if (operation === 'gptomek_get_cherry_source_tree') {
        return { truncated: false } as T;
      }
      if (operation === 'gptomek_get_cherry_target_tree') {
        return {
          truncated: false,
          tree: [{ path: 'keep.txt', mode: '100644', type: 'blob', sha: 'a'.repeat(40) }],
        } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    cherryPick(client, {
      id: 'cherry-malformed-tree',
      op: 'cherry_pick',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      commitSha: '6'.repeat(40),
    }),
    /cherry_pick_invalid_tree/,
  );
});

test('cherry_pick rechecks the guarded head immediately before updating the ref', async () => {
  const expected = '1'.repeat(40);
  const moved = '2'.repeat(40);
  let headReads = 0;
  let commitReads = 0;
  let refWrites = 0;

  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        headReads += 1;
        return { object: { sha: headReads === 1 ? expected : moved } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        commitReads += 1;
        if (commitReads === 1) {
          return {
            message: 'source',
            tree: { sha: '3'.repeat(40) },
            parents: [{ sha: '4'.repeat(40) }],
          } as T;
        }
        if (commitReads === 2) return { tree: { sha: '5'.repeat(40) }, parents: [] } as T;
        return { tree: { sha: '6'.repeat(40) }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_cherry_parent_tree') {
        return {
          truncated: false,
          tree: [{ path: 'file.txt', mode: '100644', type: 'blob', sha: 'a'.repeat(40) }],
        } as T;
      }
      if (operation === 'gptomek_get_cherry_source_tree') {
        return {
          truncated: false,
          tree: [{ path: 'file.txt', mode: '100644', type: 'blob', sha: 'b'.repeat(40) }],
        } as T;
      }
      if (operation === 'gptomek_get_cherry_target_tree') {
        return {
          truncated: false,
          tree: [{ path: 'file.txt', mode: '100644', type: 'blob', sha: 'a'.repeat(40) }],
        } as T;
      }
      if (operation === 'gptomek_create_tree') return { sha: '7'.repeat(40) } as T;
      if (operation === 'gptomek_create_commit') return { sha: '8'.repeat(40) } as T;
      if (operation === 'gptomek_update_branch') {
        refWrites += 1;
        return {} as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    cherryPick(client, {
      id: 'cherry-head-moved',
      op: 'cherry_pick',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      commitSha: '9'.repeat(40),
    }),
    /branch_head_changed/,
  );
  assert.equal(headReads, 2);
  assert.equal(refWrites, 0);
});

test('cherry_pick bounds large file-level deltas before creating a tree', async () => {
  const expected = '1'.repeat(40);
  const parentTreeSha = '2'.repeat(40);
  const sourceTreeSha = '3'.repeat(40);
  const targetTreeSha = '4'.repeat(40);
  const parentSha = '5'.repeat(40);
  const sourceSha = '6'.repeat(40);
  let commitReads = 0;
  let treeCreated = false;

  const parentEntries = Array.from({ length: 513 }, (_, index) => ({
    path: `bulk/file-${String(index).padStart(3, '0')}.txt`,
    mode: '100644',
    type: 'blob',
    sha: `${(index % 10).toString(16)}`.repeat(40),
  }));
  const sourceEntries = parentEntries.map((entry, index) => ({
    ...entry,
    sha: `${((index + 1) % 10).toString(16)}`.repeat(40),
  }));

  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        commitReads += 1;
        if (commitReads === 1) {
          return {
            message: 'bulk source',
            tree: { sha: sourceTreeSha },
            parents: [{ sha: parentSha }],
          } as T;
        }
        if (commitReads === 2) return { tree: { sha: parentTreeSha }, parents: [] } as T;
        return { tree: { sha: targetTreeSha }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_cherry_parent_tree') {
        return { truncated: false, tree: parentEntries } as T;
      }
      if (operation === 'gptomek_get_cherry_source_tree') {
        return { truncated: false, tree: sourceEntries } as T;
      }
      if (operation === 'gptomek_get_cherry_target_tree') {
        return { truncated: false, tree: parentEntries } as T;
      }
      if (operation === 'gptomek_create_tree') {
        treeCreated = true;
        return { sha: '7'.repeat(40) } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    cherryPick(client, {
      id: 'cherry-too-large',
      op: 'cherry_pick',
      repository: 'trvny/trvny',
      branch: 'feat/target',
      expectedHeadSha: expected,
      commitSha: sourceSha,
    }),
    /cherry_pick_too_many_changes/,
  );
  assert.equal(treeCreated, false);
});

test('cherry_pick validation failures are terminal mailbox results', () => {
  assert.equal(
    gptomekMailboxFailureIsTerminal('cherry_pick', 'cherry_pick_conflict'),
    true,
  );
  assert.equal(
    gptomekMailboxFailureIsTerminal('cherry_pick', 'branch_head_changed'),
    true,
  );
});
