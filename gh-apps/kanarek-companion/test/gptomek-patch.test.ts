import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyPatch,
  gptomekMailboxFailureIsTerminal,
  revertCommit,
} from '../src/gptomek.ts';
import {
  applyUnifiedFilePatch,
  parseUnifiedPatch,
} from '../src/gptomek-patch.ts';
import {
  GitHubApiError,
  type GitHubInstallationClient,
} from '../src/github-app.ts';

function base64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function requestBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

test('applies a strict multi-hunk unified patch', () => {
  const [patch] = parseUnifiedPatch([
    'diff --git a/example.txt b/example.txt',
    '--- a/example.txt',
    '+++ b/example.txt',
    '@@ -1,3 +1,3 @@',
    ' one',
    '-two',
    '+TWO',
    ' three',
    '@@ -5,1 +5,2 @@',
    ' five',
    '+six',
    '',
  ].join('\n'));

  assert.equal(
    applyUnifiedFilePatch('one\ntwo\nthree\nfour\nfive\n', patch),
    'one\nTWO\nthree\nfour\nfive\nsix\n',
  );
});

test('preserves mixed line endings outside and inside patched hunks', () => {
  const [patch] = parseUnifiedPatch([
    '--- a/example.txt',
    '+++ b/example.txt',
    '@@ -2 +2 @@',
    '-two',
    '+TWO',
    '',
  ].join('\n'));

  assert.equal(
    applyUnifiedFilePatch('one\r\ntwo\nthree\r\n', patch),
    'one\r\nTWO\nthree\r\n',
  );
});

test('validates new-side hunk positions and EOF newline metadata', () => {
  const [wrongPosition] = parseUnifiedPatch([
    '--- a/example.txt',
    '+++ b/example.txt',
    '@@ -1 +2 @@',
    '-one',
    '+ONE',
    '',
  ].join('\n'));
  assert.throws(
    () => applyUnifiedFilePatch('one\n', wrongPosition),
    /patch_new_position_mismatch/,
  );

  const [expectsNoNewline] = parseUnifiedPatch([
    '--- a/example.txt',
    '+++ b/example.txt',
    '@@ -1 +1 @@',
    '-one',
    '\\ No newline at end of file',
    '+ONE',
    '\\ No newline at end of file',
    '',
  ].join('\n'));
  assert.throws(
    () => applyUnifiedFilePatch('one\n', expectsNoNewline),
    /patch_old_eof_mismatch: expected missing final newline; regenerate with git diff; file=example.txt/,
  );
  assert.equal(applyUnifiedFilePatch('one', expectsNoNewline), 'ONE');

  const [missingEofMarker] = parseUnifiedPatch([
    '--- a/example.txt',
    '+++ b/example.txt',
    '@@ -1 +1 @@',
    '-one',
    '+ONE',
    '',
  ].join('\n'));
  assert.throws(
    () => applyUnifiedFilePatch('one', missingEofMarker),
    /patch_old_eof_mismatch: source has no final newline; preserve the git diff EOF marker; file=example.txt/,
  );
  assert.throws(
    () => applyUnifiedFilePatch('one', { ...missingEofMarker, oldPath: `${'deep/'.repeat(150)}file.txt` }),
    /patch_old_eof_mismatch: source has no final newline; preserve the git diff EOF marker; file=\.\.\..*file\.txt/,
  );
});

test('places zero-length insertion hunks after their old-side anchor', () => {
  const [patch] = parseUnifiedPatch([
    '--- a/example.txt',
    '+++ b/example.txt',
    '@@ -1,0 +2 @@',
    '+middle',
    '',
  ].join('\n'));

  assert.equal(
    applyUnifiedFilePatch('one\ntwo\n', patch),
    'one\nmiddle\ntwo\n',
  );
});

test('rejects fuzzy patch application when context does not match exactly', () => {
  const [patch] = parseUnifiedPatch([
    '--- a/example.txt',
    '+++ b/example.txt',
    '@@ -1,2 +1,2 @@',
    ' one',
    '-two',
    '+TWO',
    '',
  ].join('\n'));

  assert.throws(
    () => applyUnifiedFilePatch('ONE\ntwo\n', patch),
    /patch_context_mismatch/,
  );
});

test('supports new and deleted text files, including empty executable files', () => {
  const [added] = parseUnifiedPatch([
    'diff --git a/new.txt b/new.txt',
    'new file mode 100755',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1,2 @@',
    '+hello',
    '+world',
    '',
  ].join('\n'));
  assert.equal(added.newMode, '100755');
  assert.equal(applyUnifiedFilePatch('', added), 'hello\nworld\n');

  const [emptyAdded] = parseUnifiedPatch([
    'diff --git a/empty.sh b/empty.sh',
    'new file mode 100755',
    'index 0000000..e69de29',
    '',
  ].join('\n'));
  assert.equal(emptyAdded.newMode, '100755');
  assert.equal(applyUnifiedFilePatch('', emptyAdded), '');

  const [deleted] = parseUnifiedPatch([
    'diff --git a/old.txt b/old.txt',
    'deleted file mode 100644',
    '--- a/old.txt',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-hello',
    '-world',
    '',
  ].join('\n'));
  assert.equal(applyUnifiedFilePatch('hello\nworld\n', deleted), null);

  const [emptyDeleted] = parseUnifiedPatch([
    'diff --git a/empty.txt b/empty.txt',
    'deleted file mode 100644',
    'index e69de29..0000000',
    '',
  ].join('\n'));
  assert.equal(applyUnifiedFilePatch('', emptyDeleted), null);
});

test('rejects rename metadata instead of guessing file moves', () => {
  assert.throws(
    () => parseUnifiedPatch([
      'diff --git a/a.txt b/b.txt',
      'similarity index 100%',
      'rename from a.txt',
      'rename to b.txt',
      '',
    ].join('\n')),
    /unexpected_patch_line|unsupported_patch_metadata/,
  );
});

test('apply_patch preserves executable mode and advances to the new commit', async () => {
  const expected = 'a'.repeat(40);
  const newCommit = 'b'.repeat(40);
  const calls: Array<{ operation: string; path: string; init?: RequestInit }> = [];

  const client = {
    async json<T>(path: string, operation: string, init?: RequestInit): Promise<T> {
      calls.push({ operation, path, init });
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        return { tree: { sha: 'c'.repeat(40) }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_patch_tree') {
        return {
          truncated: false,
          tree: [{ path: 'example.txt', type: 'blob', mode: '100755' }],
        } as T;
      }
      if (operation === 'gptomek_get_patch_file') {
        return {
          type: 'file',
          encoding: 'base64',
          content: base64('before\n'),
          size: 7,
        } as T;
      }
      if (operation === 'gptomek_create_blob') {
        assert.equal(requestBody(init).content, 'after\n');
        return { sha: 'd'.repeat(40) } as T;
      }
      if (operation === 'gptomek_create_tree') {
        const body = requestBody(init);
        const tree = body.tree as Array<Record<string, unknown>>;
        assert.equal(tree[0].mode, '100755');
        return { sha: 'e'.repeat(40) } as T;
      }
      if (operation === 'gptomek_create_commit') {
        return { sha: newCommit } as T;
      }
      if (operation === 'gptomek_update_branch') {
        assert.deepEqual(requestBody(init), { sha: newCommit, force: false });
        return {} as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  const result = await applyPatch(client, {
    id: 'patch-1',
    op: 'apply_patch',
    repository: 'trvny/trvny',
    branch: 'feat/example',
    expectedHeadSha: expected,
    message: 'fix: patch example',
    patch: [
      '--- a/example.txt',
      '+++ b/example.txt',
      '@@ -1 +1 @@',
      '-before',
      '+after',
      '',
    ].join('\n'),
  });

  assert.deepEqual(result, { sha: newCommit, files: 1 });
  assert.equal(
    calls.filter(({ operation }) => operation === 'gptomek_get_branch_ref').length,
    3,
  );
  assert.equal(
    calls.filter(({ operation }) => operation === 'gptomek_update_branch').length,
    1,
  );
});

test('apply_patch preserves a UTF-8 BOM when an untouched prefix remains', async () => {
  const expected = '1'.repeat(40);
  const newCommit = '2'.repeat(40);
  const source = '\uFEFFone\ntwo\n';
  let blobContent = '';

  const client = {
    async json<T>(_path: string, operation: string, init?: RequestInit): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        return { tree: { sha: '3'.repeat(40) }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_patch_tree') {
        return {
          truncated: false,
          tree: [{ path: 'bom.txt', type: 'blob', mode: '100644' }],
        } as T;
      }
      if (operation === 'gptomek_get_patch_file') {
        return {
          type: 'file',
          encoding: 'base64',
          content: base64(source),
          size: Buffer.byteLength(source),
        } as T;
      }
      if (operation === 'gptomek_create_blob') {
        blobContent = String(requestBody(init).content);
        return { sha: '4'.repeat(40) } as T;
      }
      if (operation === 'gptomek_create_tree') {
        return { sha: '5'.repeat(40) } as T;
      }
      if (operation === 'gptomek_create_commit') {
        return { sha: newCommit } as T;
      }
      if (operation === 'gptomek_update_branch') return {} as T;
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await applyPatch(client, {
    id: 'patch-bom',
    op: 'apply_patch',
    repository: 'trvny/trvny',
    branch: 'feat/example',
    expectedHeadSha: expected,
    message: 'fix: preserve bom',
    patch: [
      '--- a/bom.txt',
      '+++ b/bom.txt',
      '@@ -2 +2 @@',
      '-two',
      '+TWO',
      '',
    ].join('\n'),
  });

  assert.equal(blobContent, '\uFEFFone\nTWO\n');
});

test('apply_patch honors executable mode on a new empty file', async () => {
  const expected = '6'.repeat(40);
  const newCommit = '7'.repeat(40);
  let treeMode: unknown;

  const client = {
    async json<T>(_path: string, operation: string, init?: RequestInit): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        return { tree: { sha: '8'.repeat(40) }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_patch_tree') {
        return { truncated: false, tree: [] } as T;
      }
      if (operation === 'gptomek_get_patch_file') {
        throw new GitHubApiError(operation, 404);
      }
      if (operation === 'gptomek_create_blob') {
        assert.equal(requestBody(init).content, '');
        return { sha: '9'.repeat(40) } as T;
      }
      if (operation === 'gptomek_create_tree') {
        const body = requestBody(init);
        const tree = body.tree as Array<Record<string, unknown>>;
        treeMode = tree[0].mode;
        return { sha: 'a'.repeat(40) } as T;
      }
      if (operation === 'gptomek_create_commit') {
        return { sha: newCommit } as T;
      }
      if (operation === 'gptomek_update_branch') return {} as T;
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await applyPatch(client, {
    id: 'patch-new-executable',
    op: 'apply_patch',
    repository: 'trvny/trvny',
    branch: 'feat/example',
    expectedHeadSha: expected,
    message: 'feat: add empty executable',
    patch: [
      'diff --git a/empty.sh b/empty.sh',
      'new file mode 100755',
      'index 0000000..e69de29',
      '',
    ].join('\n'),
  });

  assert.equal(treeMode, '100755');
});

test('apply_patch verifies an ambiguous ref-update error against the live head', async () => {
  const expected = 'b'.repeat(40);
  const newCommit = 'c'.repeat(40);
  let headReads = 0;

  const client = {
    async json<T>(_path: string, operation: string, init?: RequestInit): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        headReads += 1;
        return {
          object: { sha: headReads < 4 ? expected : newCommit },
        } as T;
      }
      if (operation === 'gptomek_get_commit') {
        return { tree: { sha: 'd'.repeat(40) }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_patch_tree') {
        return {
          truncated: false,
          tree: [{ path: 'example.txt', type: 'blob', mode: '100644' }],
        } as T;
      }
      if (operation === 'gptomek_get_patch_file') {
        return {
          type: 'file',
          encoding: 'base64',
          content: base64('before\n'),
          size: 7,
        } as T;
      }
      if (operation === 'gptomek_create_blob') return { sha: 'e'.repeat(40) } as T;
      if (operation === 'gptomek_create_tree') return { sha: 'f'.repeat(40) } as T;
      if (operation === 'gptomek_create_commit') return { sha: newCommit } as T;
      if (operation === 'gptomek_update_branch') {
        assert.deepEqual(requestBody(init), { sha: newCommit, force: false });
        throw new Error('connection_lost_after_write');
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  const result = await applyPatch(client, {
    id: 'patch-ambiguous-update',
    op: 'apply_patch',
    repository: 'trvny/trvny',
    branch: 'feat/example',
    expectedHeadSha: expected,
    message: 'fix: patch example',
    patch: [
      '--- a/example.txt',
      '+++ b/example.txt',
      '@@ -1 +1 @@',
      '-before',
      '+after',
      '',
    ].join('\n'),
  });

  assert.deepEqual(result, { sha: newCommit, files: 1 });
  assert.equal(headReads, 4);
});

test('apply_patch keeps a verified no-op ref failure retryable', async () => {
  const expected = '1'.repeat(40);

  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        return { tree: { sha: '2'.repeat(40) }, parents: [] } as T;
      }
      if (operation === 'gptomek_get_patch_tree') {
        return {
          truncated: false,
          tree: [{ path: 'example.txt', type: 'blob', mode: '100644' }],
        } as T;
      }
      if (operation === 'gptomek_get_patch_file') {
        return {
          type: 'file',
          encoding: 'base64',
          content: base64('before\n'),
          size: 7,
        } as T;
      }
      if (operation === 'gptomek_create_blob') return { sha: '3'.repeat(40) } as T;
      if (operation === 'gptomek_create_tree') return { sha: '4'.repeat(40) } as T;
      if (operation === 'gptomek_create_commit') return { sha: '5'.repeat(40) } as T;
      if (operation === 'gptomek_update_branch') {
        throw new Error('connection_lost_before_write');
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    applyPatch(client, {
      id: 'patch-no-op-update',
      op: 'apply_patch',
      repository: 'trvny/trvny',
      branch: 'feat/example',
      expectedHeadSha: expected,
      message: 'fix: patch example',
      patch: [
        '--- a/example.txt',
        '+++ b/example.txt',
        '@@ -1 +1 @@',
        '-before',
        '+after',
        '',
      ].join('\n'),
    }),
    /branch_update_not_applied/,
  );
});

test('revert_commit restores the parent tree only when the target is current HEAD', async () => {
  const expected = 'a'.repeat(40);
  const parent = 'b'.repeat(40);
  const parentTree = 'c'.repeat(40);
  const reverted = 'd'.repeat(40);
  const calls: Array<{ operation: string; body?: unknown }> = [];

  const client = {
    async json<T>(_path: string, operation: string, init?: RequestInit): Promise<T> {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ operation, body });
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      if (operation === 'gptomek_get_commit') {
        const seen = calls.filter((call) => call.operation === 'gptomek_get_commit').length;
        if (seen === 1) {
          return {
            tree: { sha: 'e'.repeat(40) },
            parents: [{ sha: parent }],
          } as T;
        }
        return { tree: { sha: parentTree }, parents: [] } as T;
      }
      if (operation === 'gptomek_create_commit') {
        assert.equal(body.tree, parentTree);
        assert.deepEqual(body.parents, [expected]);
        return { sha: reverted } as T;
      }
      if (operation === 'gptomek_update_branch') {
        assert.deepEqual(body, { sha: reverted, force: false });
        return {} as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  const result = await revertCommit(client, {
    id: 'revert-1',
    op: 'revert_commit',
    repository: 'trvny/trvny',
    branch: 'feat/example',
    expectedHeadSha: expected,
    commitSha: expected,
    message: 'revert: bad change',
  });

  assert.deepEqual(result, { sha: reverted, reverted: expected });
  assert.equal(
    calls.filter(({ operation }) => operation === 'gptomek_update_branch').length,
    1,
  );
});

test('revert_commit refuses older commits to avoid clobbering later changes', async () => {
  const expected = 'a'.repeat(40);
  const client = {
    async json<T>(_path: string, operation: string): Promise<T> {
      if (operation === 'gptomek_get_branch_ref') {
        return { object: { sha: expected } } as T;
      }
      throw new Error(`unexpected:${operation}`);
    },
  } as unknown as GitHubInstallationClient;

  await assert.rejects(
    revertCommit(client, {
      id: 'revert-old',
      op: 'revert_commit',
      repository: 'trvny/trvny',
      branch: 'feat/example',
      expectedHeadSha: expected,
      commitSha: 'f'.repeat(40),
      message: 'revert: old change',
    }),
    /revert_target_not_head/,
  );
});

test('new deterministic patch and revert failures are terminal mailbox results', () => {
  for (const error of [
    'patch_context_mismatch',
    'patch_invalid_path',
    'invalid_patch_hunk_header',
    'invalid_patch_no_newline_marker',
  ]) {
    assert.equal(gptomekMailboxFailureIsTerminal('apply_patch', error), true);
  }
  assert.equal(
    gptomekMailboxFailureIsTerminal('revert_commit', 'revert_target_not_head'),
    true,
  );
});
