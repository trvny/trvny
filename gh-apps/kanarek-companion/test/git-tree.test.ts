import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveGitTreeEntries, type GitTreeEntry } from '../src/git-tree.ts';

test('git tree resolver walks requested paths and caches shared trees', async () => {
  const trees = new Map<string, GitTreeEntry[]>([
    ['root', [
      { path: 'src', mode: '040000', type: 'tree', sha: 'src-tree' },
      { path: 'link', mode: '120000', type: 'blob', sha: 'link-blob' },
    ]],
    ['src-tree', [
      { path: 'run.sh', mode: '100755', type: 'blob', sha: 'run-blob' },
      { path: 'plain.ts', mode: '100644', type: 'blob', sha: 'plain-blob' },
    ]],
  ]);
  const reads: string[] = [];
  const result = await resolveGitTreeEntries(
    'root',
    ['src/run.sh', 'src/plain.ts', 'link', 'missing.txt'],
    async (sha) => {
      reads.push(sha);
      return trees.get(sha) ?? [];
    },
  );

  assert.equal(result.get('src/run.sh')?.mode, '100755');
  assert.equal(result.get('src/plain.ts')?.sha, 'plain-blob');
  assert.equal(result.get('link')?.mode, '120000');
  assert.equal(result.has('missing.txt'), false);
  assert.deepEqual(reads.sort(), ['root', 'src-tree']);
});
