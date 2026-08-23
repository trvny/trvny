#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, got {count}")
    return text.replace(old, new, 1)


code_path = Path('gh-apps/kanarek-companion/src/code-change-orchestration.ts')
code = code_path.read_text()

code = replace_once(
    code,
    "type EditAction = { type: 'edit'; message: string; files: EditFile[] };",
    "type EditAction = { type: 'edit'; headSha: string; revision: number; message: string; files: EditFile[] };",
    'edit action type',
)

code = replace_once(
    code,
    """  if (value.type === 'edit') {
    return {
      type: 'edit',
      message: requiredText(value.message, 'commit_message', 1_000),
      files: editFiles(value.files, scope),
    };
  }
""",
    """  if (value.type === 'edit') {
    const revision = numberValue(value.revision);
    if (revision === null || revision < 0) throw new CodeChangeError('invalid_edit_revision');
    return {
      type: 'edit',
      headSha: expectedSha(value.headSha, 'edit_head_sha'),
      revision,
      message: requiredText(value.message, 'commit_message', 1_000),
      files: editFiles(value.files, scope),
    };
  }
""",
    'edit parser',
)

snapshot_marker = "async function targetFileSnapshots(\n"
helper = """type TargetTreeEntry = { mode: string; type: string; sha: string };

async function commitTreeSha(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
): Promise<string> {
  const raw = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/git/commits/${encodeURIComponent(ref)}`,
  );
  const tree = isObject(raw) && isObject(raw.tree) ? raw.tree : null;
  const sha = tree ? stringValue(tree.sha) : null;
  if (!sha || !SHA_RE.test(sha)) throw new CodeChangeError('invalid_commit_tree_response', 502);
  return sha.toLowerCase();
}

async function targetTreeEntry(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  treeSha: string,
  path: string,
): Promise<TargetTreeEntry | null> {
  let currentTreeSha = treeSha;
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    const raw = await readData(
      source,
      invoke,
      `/repos/${repoPath(core.repository)}/git/trees/${currentTreeSha}`,
    );
    if (!isObject(raw) || !Array.isArray(raw.tree)) {
      throw new CodeChangeError('invalid_tree_response', 502, { path });
    }
    const entry = raw.tree.find((value) => isObject(value) && stringValue(value.path) === parts[index]);
    if (!isObject(entry)) return null;
    const mode = stringValue(entry.mode);
    const type = stringValue(entry.type);
    const sha = stringValue(entry.sha);
    if (!mode || !type || !sha || !SHA_RE.test(sha)) {
      throw new CodeChangeError('invalid_tree_entry', 502, { path });
    }
    if (index === parts.length - 1) return { mode, type, sha: sha.toLowerCase() };
    if (type !== 'tree') return null;
    currentTreeSha = sha.toLowerCase();
  }
  return null;
}

"""
code = replace_once(code, snapshot_marker, helper + snapshot_marker, 'target tree helpers')

old_snapshots = """async function targetFileSnapshots(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
): Promise<Array<{ path: string; exists: boolean; content: string | null }>> {
  return Promise.all(core.targetPaths.map(async (path) => {
    const { response, payload } = await invokePayload(
      source,
      invoke,
      READ_PATH,
      { path: `/repos/${repoPath(core.repository)}/contents/${contentPath(path)}?ref=${encodeURIComponent(ref)}` },
      true,
    );
    if (response.status === 404) return { path, exists: false, content: null };
    if (!response.ok || payload.ok !== true) {
      throw new CodeChangeError(
        typeof payload.error === 'string' ? payload.error : 'target_file_read_failed',
        response.status,
        { path },
      );
    }
    const content = decodeContent(payload.data);
    if (content === null) throw new CodeChangeError('target_file_not_decodable', 502, { path });
    if (content.length > MAX_FILE_CONTENT) {
      throw new CodeChangeError('file_content_too_large', 413, { path });
    }
    return { path, exists: true, content };
  }));
}
"""
new_snapshots = """async function targetFileSnapshots(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  ref: string,
): Promise<Array<{ path: string; exists: boolean; content: string | null }>> {
  const treeSha = await commitTreeSha(source, invoke, core, ref);
  return Promise.all(core.targetPaths.map(async (path) => {
    const entry = await targetTreeEntry(source, invoke, core, treeSha, path);
    if (entry?.mode === '120000') {
      throw new CodeChangeError('symlink_target_not_editable', 409, { path });
    }
    if (entry && entry.type !== 'blob') {
      throw new CodeChangeError('unsupported_target_type', 409, { path, type: entry.type });
    }
    const { response, payload } = await invokePayload(
      source,
      invoke,
      READ_PATH,
      { path: `/repos/${repoPath(core.repository)}/contents/${contentPath(path)}?ref=${encodeURIComponent(ref)}` },
      true,
    );
    if (response.status === 404) return { path, exists: false, content: null };
    if (!response.ok || payload.ok !== true) {
      throw new CodeChangeError(
        typeof payload.error === 'string' ? payload.error : 'target_file_read_failed',
        response.status,
        { path },
      );
    }
    const content = decodeContent(payload.data);
    if (content === null) throw new CodeChangeError('target_file_not_decodable', 502, { path });
    if (content.length > MAX_FILE_CONTENT) {
      throw new CodeChangeError('file_content_too_large', 413, { path });
    }
    return { path, exists: true, content };
  }));
}
"""
code = replace_once(code, old_snapshots, new_snapshots, 'target snapshots')

verify_marker = "async function verifyRecoveredCommit(\n"
verify_helper = """export function recoveredChangedPathsAllowed(changed: string[], submitted: string[]): boolean {
  const allowed = new Set(submitted);
  return new Set(changed).size === changed.length && changed.every((path) => allowed.has(path));
}

"""
code = replace_once(code, verify_marker, verify_helper + verify_marker, 'recovered changed helper')
code = replace_once(
    code,
    """  if (changed.length !== edit.files.length || new Set(changed).size !== changed.length) return false;
  if (!edit.files.every((file) => changed.includes(file.path))) return false;
""",
    """  if (!recoveredChangedPathsAllowed(changed, edit.files.map((file) => file.path))) return false;
""",
    'recovered changed paths',
)

verification_marker = "function verificationNextAction(progress: Progress): JsonObject {"
edit_next = """function editNextAction(progress: Progress, note: string): JsonObject {
  return {
    type: 'edit',
    headSha: progress.branchHead,
    revision: progress.revision,
    note,
  };
}

"""
code = replace_once(code, verification_marker, edit_next + verification_marker, 'edit next action helper')

for label, old, new in [
    (
        'editing response next action',
        """    nextAction: {
      type: 'edit',
      note: 'Use targetFiles as the authoritative full snapshot. Submit complete replacement contents only for declared targetPaths; missing targets are marked exists:false.',
    },
""",
        """    nextAction: editNextAction(
      progress,
      'Use targetFiles as the authoritative full snapshot. Submit complete replacement contents only for declared targetPaths; missing targets are marked exists:false.',
    ),
""",
    ),
    (
        'initial editing next action',
        """      nextAction: {
        type: 'edit',
        note: 'Use targetFiles as the authoritative full snapshot. Submit complete replacement contents only for declared targetPaths; missing targets are marked exists:false.',
      },
""",
        """      nextAction: editNextAction(
        progress,
        'Use targetFiles as the authoritative full snapshot. Submit complete replacement contents only for declared targetPaths; missing targets are marked exists:false.',
      ),
""",
    ),
    (
        'failed verification edit action',
        "nextAction: { type: 'edit', note: 'Fix the failed targeted verification on the same guarded branch.' },",
        "nextAction: editNextAction(next, 'Fix the failed targeted verification on the same guarded branch.'),",
    ),
    (
        'ci failure edit action',
        "? { type: 'edit', note: 'Diagnose the failed CI before finalization.' }",
        "? editNextAction(progress, 'Diagnose the failed CI before finalization.')",
    ),
]:
    code = replace_once(code, old, new, label)

code = replace_once(
    code,
    """    if (submitted?.type === 'edit') {
      if (progress.stage !== 'editing' && progress.stage !== 'waiting_ci_review') {
        throw new CodeChangeError('edit_not_allowed_in_stage', 409, { stage: progress.stage });
      }

""",
    """    if (submitted?.type === 'edit') {
      if (progress.stage !== 'editing' && progress.stage !== 'waiting_ci_review') {
        throw new CodeChangeError('edit_not_allowed_in_stage', 409, { stage: progress.stage });
      }
      if (submitted.headSha !== progress.branchHead || submitted.revision !== progress.revision) {
        throw new CodeChangeError('edit_revision_changed', 409, {
          expectedHeadSha: progress.branchHead,
          expectedRevision: progress.revision,
        });
      }

""",
    'edit freshness guard',
)

code = replace_once(
    code,
    "required: ['type', 'message', 'files'],",
    "required: ['type', 'headSha', 'revision', 'message', 'files'],",
    'edit openapi required',
)
code = replace_once(
    code,
    """                        type: { type: 'string', enum: ['edit'] },
                        message: { type: 'string' },
""",
    """                        type: { type: 'string', enum: ['edit'] },
                        headSha: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' },
                        revision: { type: 'integer', minimum: 0 },
                        message: { type: 'string' },
""",
    'edit openapi properties',
)

code_path.write_text(code)

# Replace recursive full-tree lookup with per-path tree walking.
gpt_path = Path('gh-apps/kanarek-companion/src/gpt-actions.ts')
gpt = gpt_path.read_text()
old_tree = """async function baseTreeEntries(
  client: GitHubInstallationClient,
  repositoryName: string,
  treeSha: string,
): Promise<Map<string, ContentTreeEntry>> {
  const data = await client.json<{
    truncated?: boolean;
    tree?: Array<{ path?: string; mode?: string; type?: string }>;
  }>(
    `/repos/${repoPath(repositoryName)}/git/trees/${treeSha}?recursive=1`,
    'gpt_action_get_base_tree',
  );
  if (data.truncated === true || !Array.isArray(data.tree)) {
    throw new ActionError('base_tree_not_readable', 502);
  }
  const entries = new Map<string, ContentTreeEntry>();
  for (const entry of data.tree) {
    if (typeof entry.path === 'string' && typeof entry.mode === 'string' && typeof entry.type === 'string') {
      entries.set(entry.path, { mode: entry.mode, type: entry.type });
    }
  }
  return entries;
}
"""
new_tree = """async function baseTreeEntry(
  client: GitHubInstallationClient,
  repositoryName: string,
  treeSha: string,
  path: string,
): Promise<ContentTreeEntry | undefined> {
  let currentTreeSha = treeSha;
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    const data = await client.json<{
      tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string }>;
    }>(
      `/repos/${repoPath(repositoryName)}/git/trees/${currentTreeSha}`,
      'gpt_action_get_base_tree_entry',
    );
    if (!Array.isArray(data.tree)) throw new ActionError('base_tree_not_readable', 502);
    const entry = data.tree.find((value) => value.path === parts[index]);
    if (!entry) return undefined;
    if (typeof entry.mode !== 'string' || typeof entry.type !== 'string') {
      throw new ActionError('base_tree_not_readable', 502);
    }
    if (index === parts.length - 1) return { mode: entry.mode, type: entry.type };
    if (entry.type !== 'tree' || typeof entry.sha !== 'string' || !SHA_RE.test(entry.sha)) {
      return undefined;
    }
    currentTreeSha = entry.sha;
  }
  return undefined;
}
"""
gpt = replace_once(gpt, old_tree, new_tree, 'per path tree lookup')
gpt = replace_once(
    gpt,
    """  const baseCommit = await commitData(client, repositoryName, expectedHeadSha);
  const baseEntries = await baseTreeEntries(client, repositoryName, baseCommit.tree.sha);

  const tree = await Promise.all(
    files.map(async (file) => {
      const mode = contentTreeMode(baseEntries.get(file.path));
""",
    """  const baseCommit = await commitData(client, repositoryName, expectedHeadSha);

  const tree = await Promise.all(
    files.map(async (file) => {
      const mode = contentTreeMode(
        await baseTreeEntry(client, repositoryName, baseCommit.tree.sha, file.path),
      );
""",
    'commit per path mode lookup',
)
gpt_path.write_text(gpt)

# Tests for the edit contract and unchanged-file recovery.
test_path = Path('gh-apps/kanarek-companion/test/code-change-orchestration.test.ts')
test = test_path.read_text()
test = replace_once(
    test,
    """  addCodeChangeAutopilotOpenApi,
  reviewGateBlockers,
""",
    """  addCodeChangeAutopilotOpenApi,
  recoveredChangedPathsAllowed,
  reviewGateBlockers,
""",
    'test import',
)
test = replace_once(
    test,
    """  const verification = variants[1];
""",
    """  const edit = variants[0];
  assert.deepEqual(edit.required, ['type', 'headSha', 'revision', 'message', 'files']);
  const verification = variants[1];
""",
    'edit schema test',
)
review_marker = "test('review gate requires exact base, reviewed head and successful final CI', () => {"
recovery_test = """test('recovered commit may omit unchanged submitted paths but cannot touch outside scope', () => {
  assert.equal(recoveredChangedPathsAllowed(['src/a.ts'], ['src/a.ts', 'src/b.ts']), true);
  assert.equal(recoveredChangedPathsAllowed([], ['src/a.ts']), true);
  assert.equal(recoveredChangedPathsAllowed(['src/other.ts'], ['src/a.ts']), false);
  assert.equal(recoveredChangedPathsAllowed(['src/a.ts', 'src/a.ts'], ['src/a.ts']), false);
});

"""
test = replace_once(test, review_marker, recovery_test + review_marker, 'recovery test')
test_path.write_text(test)

Path(__file__).unlink()
