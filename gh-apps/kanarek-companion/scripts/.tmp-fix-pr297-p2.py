#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
ORCH = ROOT / "src" / "code-change-orchestration.ts"
GPT = ROOT / "src" / "gpt-actions.ts"
ORCH_TEST = ROOT / "test" / "code-change-orchestration.test.ts"
GPT_TEST = ROOT / "test" / "gpt-actions.test.ts"

def sub_once(text: str, pattern: str, repl: str, *, flags=0, label: str) -> str:
    new, count = re.subn(pattern, repl, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    return new

def replace_once(text: str, old: str, new: str, *, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one literal match, got {count}")
    return text.replace(old, new, 1)

orch = ORCH.read_text()

orch = sub_once(
    orch,
    r"type EditFile = \{ path: string; content: string \| null \};\n"
    r"type EditAction = \{ type: 'edit'; message: string; files: EditFile\[\] \};\n"
    r"type VerificationAction = \{\n"
    r"  type: 'verification';\n"
    r"  status: 'passed' \| 'failed' \| 'unavailable';\n"
    r"  reason\?: string;\n"
    r"  results\?: JsonObject\[\];\n"
    r"  pullRequest\?: \{ title: string; body: string \};\n"
    r"\};",
    """type EditFile = { path: string; content: string | null };
type EditAction = { type: 'edit'; message: string; files: EditFile[] };
type VerificationResult = {
  status: 'passed' | 'failed';
  cwd: string;
  command: string;
};
type VerificationAction = {
  type: 'verification';
  status: 'passed' | 'failed' | 'unavailable';
  headSha: string;
  revision: number;
  reason?: string;
  results?: VerificationResult[];
  pullRequest?: { title: string; body: string };
};""",
    label="verification types",
)

orch = replace_once(
    orch,
    "const MAX_FILE_CONTENT = 96_000;\n",
    """const MAX_FILE_CONTENT = 96_000;
const MAX_RECOVERED_COMMITS = 50;
const GPTOMEK_COMMIT_NAME = 'GPTomek';
const GPTOMEK_COMMIT_EMAIL = '314538226+gptomek[bot]@users.noreply.github.com';
""",
    label="recovery constants",
)

orch = sub_once(
    orch,
    r"  if \(value\.type === 'verification'\) \{\n.*?\n  \}\n  if \(value\.type === 'review'\) \{",
    """  if (value.type === 'verification') {
    if (value.status !== 'passed' && value.status !== 'failed' && value.status !== 'unavailable') {
      throw new CodeChangeError('invalid_verification_status');
    }
    const headSha = expectedSha(value.headSha, 'verification_head_sha');
    const revision = numberValue(value.revision);
    if (revision === null || revision < 1) throw new CodeChangeError('invalid_verification_revision');
    const reason = value.reason === undefined ? undefined : requiredText(value.reason, 'verification_reason', 2_000);
    if (value.status === 'unavailable' && !reason) throw new CodeChangeError('verification_reason_required');
    let results: VerificationResult[] | undefined;
    if (value.results !== undefined) {
      if (!Array.isArray(value.results) || value.results.length > 30) {
        throw new CodeChangeError('invalid_verification_results');
      }
      results = value.results.map((entry) => {
        if (!isObject(entry) || (entry.status !== 'passed' && entry.status !== 'failed')) {
          throw new CodeChangeError('invalid_verification_results');
        }
        return {
          status: entry.status,
          cwd: requiredText(entry.cwd, 'verification_cwd', 1_000),
          command: requiredText(entry.command, 'verification_command', 8_000),
        };
      });
    }
    let pullRequest: VerificationAction['pullRequest'];
    if (value.pullRequest !== undefined) {
      if (!isObject(value.pullRequest)) throw new CodeChangeError('invalid_pull_request');
      pullRequest = {
        title: requiredText(value.pullRequest.title, 'pull_request_title', 500),
        body: typeof value.pullRequest.body === 'string' && value.pullRequest.body.length <= 8_000
          ? value.pullRequest.body
          : '',
      };
    }
    return {
      type: 'verification',
      status: value.status,
      headSha,
      revision,
      ...(reason ? { reason } : {}),
      ...(results ? { results } : {}),
      ...(pullRequest ? { pullRequest } : {}),
    };
  }
  if (value.type === 'review') {""",
    flags=re.S,
    label="verification parser",
)

orch = sub_once(
    orch,
    r"function verificationEvidenceMissing\(plan: JsonObject, results: JsonObject\[\]\): string\[\] \{\n.*?\n\}",
    """function verificationEvidenceMissing(plan: JsonObject, results: VerificationResult[]): string[] {
  const passed = new Set(
    results
      .filter((result) => result.status === 'passed')
      .map((result) => `${result.cwd}\\n${result.command}`),
  );
  return verificationCommands(plan)
    .filter((expected) => !passed.has(`${expected.cwd}\\n${expected.command}`))
    .map((expected) => `${expected.cwd}: ${expected.command}`);
}

function verificationNextAction(progress: Progress): JsonObject {
  return {
    type: 'verification',
    headSha: progress.branchHead,
    revision: progress.revision,
    allowedStatuses: ['passed', 'failed', 'unavailable'],
  };
}""",
    flags=re.S,
    label="verification evidence",
)

recovery_helpers = r'''type RecoveredBranch = {
  revision: number;
  pullRequest?: PullRequestProgress;
};

function commitIdentityMatches(value: unknown): boolean {
  if (!isObject(value)) return false;
  return stringValue(value.name) === GPTOMEK_COMMIT_NAME && stringValue(value.email) === GPTOMEK_COMMIT_EMAIL;
}

async function recoverEvolvedBranch(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
  currentBranch: string,
  defaultBranch: string,
): Promise<RecoveredBranch> {
  const compare = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/compare/${core.expectedBaseSha}...${currentBranch}`,
  );
  if (!isObject(compare) || compare.status !== 'ahead') {
    throw new CodeChangeError('branch_not_recoverable', 409);
  }
  const aheadBy = numberValue(compare.ahead_by);
  const commits = Array.isArray(compare.commits) ? compare.commits : [];
  if (
    aheadBy === null ||
    aheadBy < 1 ||
    aheadBy > MAX_RECOVERED_COMMITS ||
    commits.length !== aheadBy
  ) {
    throw new CodeChangeError('branch_history_not_recoverable', 409);
  }

  let expectedParent = core.expectedBaseSha;
  for (const value of commits) {
    if (!isObject(value) || !Array.isArray(value.parents) || value.parents.length !== 1) {
      throw new CodeChangeError('branch_history_not_recoverable', 409);
    }
    const sha = stringValue(value.sha);
    const parent = isObject(value.parents[0]) ? stringValue(value.parents[0].sha) : null;
    const commit = isObject(value.commit) ? value.commit : null;
    if (
      !sha ||
      !SHA_RE.test(sha) ||
      !parent ||
      parent.toLowerCase() !== expectedParent ||
      !commit ||
      !commitIdentityMatches(commit.author) ||
      !commitIdentityMatches(commit.committer)
    ) {
      throw new CodeChangeError('branch_history_not_recoverable', 409);
    }
    expectedParent = sha.toLowerCase();
  }
  if (expectedParent !== currentBranch) {
    throw new CodeChangeError('branch_history_not_recoverable', 409);
  }

  const allowed = new Set(core.targetPaths);
  const files = Array.isArray(compare.files) ? compare.files : [];
  if (
    !files.length ||
    files.some((value) => !isObject(value) || !stringValue(value.filename) || !allowed.has(String(value.filename)))
  ) {
    throw new CodeChangeError('branch_scope_changed', 409);
  }

  const rawPullRequests = await readData(
    source,
    invoke,
    `/repos/${repoPath(core.repository)}/pulls?state=all&head=${encodeURIComponent(`trvny:${core.branch}`)}&per_page=10`,
  );
  const pullRequests = Array.isArray(rawPullRequests) ? rawPullRequests.filter(isObject) : [];
  if (pullRequests.length > 1) throw new CodeChangeError('ambiguous_pull_request', 409);
  if (!pullRequests.length) return { revision: aheadBy };

  const raw = pullRequests[0];
  const head = isObject(raw.head) ? raw.head : {};
  const base = isObject(raw.base) ? raw.base : {};
  if (stringValue(raw.state) !== 'open' || typeof raw.merged_at === 'string') {
    throw new CodeChangeError('pull_request_not_open', 409);
  }
  if (stringValue(head.ref) !== core.branch) {
    throw new CodeChangeError('pull_request_branch_changed', 409);
  }
  if (stringValue(base.ref) !== defaultBranch) {
    throw new CodeChangeError('pull_request_base_changed', 409);
  }
  return {
    revision: aheadBy,
    pullRequest: pullRequestProgress(raw, currentBranch),
  };
}
'''

orch = replace_once(
    orch,
    "\nasync function preparationContext(source: Request, invoke: Invoke, core: CoreInput): Promise<JsonObject> {",
    "\n" + recovery_helpers + "\nasync function preparationContext(source: Request, invoke: Invoke, core: CoreInput): Promise<JsonObject> {",
    label="insert recovery helpers",
)

orch = sub_once(
    orch,
    r"async function preparationContext\(source: Request, invoke: Invoke, core: CoreInput\): Promise<JsonObject> \{\n.*?\n\}\n\nasync function investigationContext",
    r'''async function preparationContext(source: Request, invoke: Invoke, core: CoreInput): Promise<JsonObject> {
  const prepareBody: JsonObject = {
    repository: core.repository,
    branch: core.branch,
    expectedBaseSha: core.expectedBaseSha,
    targetPaths: core.targetPaths,
    ...(core.issueNumber ? { issueNumber: core.issueNumber } : {}),
  };
  const prepared = await invokePayload(source, invoke, PREPARE_CHANGE_PATH, prepareBody, true);
  if (prepared.response.ok && prepared.payload.ok === true) return prepared.payload;

  if (prepared.payload.error !== 'branch_already_exists') {
    throw new CodeChangeError(
      typeof prepared.payload.error === 'string' ? prepared.payload.error : `action_${prepared.response.status}`,
      prepared.response.status,
      prepared.payload,
    );
  }

  const [currentBranch, currentBase] = await Promise.all([
    branchHead(source, invoke, core),
    defaultBranchHead(source, invoke, core),
  ]);
  const guidance = await targetGuidance(source, invoke, core, currentBranch);

  if (currentBranch === core.expectedBaseSha) {
    if (currentBase.sha !== core.expectedBaseSha) {
      throw new CodeChangeError('base_head_changed', 409, { currentBase: currentBase.sha, expected: core.expectedBaseSha });
    }
    const open = await readData(
      source,
      invoke,
      `/repos/${repoPath(core.repository)}/pulls?state=open&head=${encodeURIComponent(`trvny:${core.branch}`)}&per_page=10`,
    );
    if (Array.isArray(open) && open.length) {
      throw new CodeChangeError('pull_request_already_exists', 409);
    }
    return {
      ok: true,
      recovered: true,
      repository: { name: core.repository, defaultBranch: currentBase.defaultBranch, baseSha: core.expectedBaseSha },
      branch: { name: core.branch, sha: currentBranch, created: false, revision: 0 },
      agentGuidance: guidance,
    };
  }

  const recovered = await recoverEvolvedBranch(
    source,
    invoke,
    core,
    currentBranch,
    currentBase.defaultBranch,
  );
  return {
    ok: true,
    recovered: true,
    recoveredEvolved: true,
    repository: { name: core.repository, defaultBranch: currentBase.defaultBranch, baseSha: core.expectedBaseSha },
    branch: { name: core.branch, sha: currentBranch, created: false, revision: recovered.revision },
    ...(recovered.pullRequest ? { pullRequest: recovered.pullRequest } : {}),
    agentGuidance: guidance,
  };
}

async function investigationContext''',
    flags=re.S,
    label="preparation recovery",
)

orch = sub_once(
    orch,
    r"async function initialProgress\(\n  source: Request,\n  invoke: Invoke,\n  core: CoreInput,\n\): Promise<\{ progress: Progress; body: JsonObject \}> \{\n.*?\n\}\n\nasync function run",
    r'''async function initialProgress(
  source: Request,
  invoke: Invoke,
  core: CoreInput,
): Promise<{ progress: Progress; body: JsonObject }> {
  const prepared = await preparationContext(source, invoke, core);
  const repositoryData = isObject(prepared.repository) ? prepared.repository : {};
  const branchData = isObject(prepared.branch) ? prepared.branch : {};
  const defaultBranch = stringValue(repositoryData.defaultBranch);
  const branchSha = stringValue(branchData.sha);
  const revision = numberValue(branchData.revision) ?? 0;
  if (!defaultBranch || !branchSha || !SHA_RE.test(branchSha) || revision < 0) {
    throw new CodeChangeError('invalid_prepare_change_response', 502);
  }

  let pullRequest: PullRequestProgress | undefined;
  if (isObject(prepared.pullRequest)) {
    const number = numberValue(prepared.pullRequest.number);
    const headSha = stringValue(prepared.pullRequest.headSha);
    if (!number || !headSha || headSha.toLowerCase() !== branchSha.toLowerCase()) {
      throw new CodeChangeError('invalid_prepare_change_response', 502);
    }
    pullRequest = {
      number,
      headSha: headSha.toLowerCase(),
      htmlUrl: stringValue(prepared.pullRequest.htmlUrl),
    };
  }

  const progress: Progress = {
    stage: revision > 0 ? 'verifying' : 'editing',
    defaultBranch,
    branchHead: branchSha.toLowerCase(),
    revision,
    ...(pullRequest ? { pullRequest } : {}),
  };

  if (revision > 0) {
    const verificationPlan = await targetedVerification(source, invoke, core, progress.branchHead);
    return {
      progress,
      body: {
        ok: true,
        recovered: true,
        stage: 'verifying',
        revision,
        headSha: progress.branchHead,
        preparation: prepared,
        verificationPlan,
        finalGate: 'Normal repository CI on the final PR head remains mandatory.',
        nextAction: verificationNextAction(progress),
      },
    };
  }

  const [investigated, targetFiles] = await Promise.all([
    investigationContext(source, invoke, core, progress.branchHead),
    targetFileSnapshots(source, invoke, core, progress.branchHead),
  ]);
  return {
    progress,
    body: {
      ok: true,
      stage: 'editing',
      goal: core.goal,
      branch: { name: core.branch, headSha: progress.branchHead },
      preparation: prepared,
      targetFiles,
      ...investigated,
      nextAction: {
        type: 'edit',
        note: 'Use targetFiles as the authoritative full snapshot. Submit complete replacement contents only for declared targetPaths; missing targets are marked exists:false.',
      },
    },
  };
}

async function run''',
    flags=re.S,
    label="initial recovery progress",
)

orch = sub_once(
    orch,
    r"    if \(submitted\?\.type === 'edit'\) \{\n.*?\n    \}\n\n    if \(submitted\?\.type === 'verification'\) \{",
    r'''    if (submitted?.type === 'edit') {
      if (progress.stage !== 'editing' && progress.stage !== 'waiting_ci_review') {
        throw new CodeChangeError('edit_not_allowed_in_stage', 409, { stage: progress.stage });
      }

      let editProgress = progress;
      if (progress.stage === 'waiting_ci_review') {
        if (!progress.pullRequest) throw new CodeChangeError('missing_pull_request_progress', 500);
        const current = await branchHead(request, invoke, core);
        if (current !== progress.branchHead) {
          if (!await verifyRecoveredCommit(request, invoke, core, progress.branchHead, current, submitted)) {
            throw new CodeChangeError('branch_head_changed', 409, { expected: progress.branchHead, current });
          }
          editProgress = {
            ...progress,
            branchHead: current,
            pullRequest: { ...progress.pullRequest, headSha: current },
          };
        }
        await assertPullRequestEditable(request, invoke, core, editProgress);
      }

      const previousHead = editProgress.branchHead;
      const newHead = await commitEdit(request, invoke, core, editProgress, submitted);
      if (progress.stage === 'waiting_ci_review' && newHead !== previousHead) {
        editProgress = {
          ...editProgress,
          branchHead: newHead,
          pullRequest: editProgress.pullRequest
            ? { ...editProgress.pullRequest, headSha: newHead }
            : undefined,
        };
        await assertPullRequestEditable(request, invoke, core, editProgress);
      }

      const verificationPlan = await targetedVerification(request, invoke, core, newHead);
      const next: Progress = {
        ...editProgress,
        stage: 'verifying',
        branchHead: newHead,
        revision: progress.revision + 1,
        ...(editProgress.pullRequest
          ? { pullRequest: { ...editProgress.pullRequest, headSha: newHead } }
          : {}),
      };
      delete next.verification;
      return pause(env, core, inputHash, next, {
        ok: true,
        stage: 'verifying',
        revision: next.revision,
        headSha: newHead,
        verificationPlan,
        finalGate: 'Normal repository CI on the final PR head remains mandatory.',
        nextAction: verificationNextAction(next),
      });
    }

    if (submitted?.type === 'verification') {''',
    flags=re.S,
    label="follow-up edit recovery",
)

orch = replace_once(
    orch,
    """      if (progress.stage !== 'verifying') {
        throw new CodeChangeError('verification_not_allowed_in_stage', 409, { stage: progress.stage });
      }
      const verificationPlan = await targetedVerification(request, invoke, core, progress.branchHead);
""",
    """      if (progress.stage !== 'verifying') {
        throw new CodeChangeError('verification_not_allowed_in_stage', 409, { stage: progress.stage });
      }
      if (submitted.headSha !== progress.branchHead || submitted.revision !== progress.revision) {
        throw new CodeChangeError('verification_revision_changed', 409, {
          expectedHeadSha: progress.branchHead,
          expectedRevision: progress.revision,
        });
      }
      const verificationPlan = await targetedVerification(request, invoke, core, progress.branchHead);
""",
    label="verification freshness gate",
)

orch = replace_once(
    orch,
    "        nextAction: { type: 'verification', allowedStatuses: ['passed', 'failed', 'unavailable'] },\n",
    "        nextAction: verificationNextAction(progress),\n",
    label="resume verification nextAction",
)

orch = replace_once(
    orch,
    """                      required: ['type', 'status'],
                      properties: {
                        type: { type: 'string', enum: ['verification'] },
                        status: { type: 'string', enum: ['passed', 'failed', 'unavailable'] },
                        reason: { type: 'string' },
                        results: { type: 'array', items: { type: 'object', properties: {} } },
""",
    """                      required: ['type', 'status', 'headSha', 'revision'],
                      properties: {
                        type: { type: 'string', enum: ['verification'] },
                        status: { type: 'string', enum: ['passed', 'failed', 'unavailable'] },
                        headSha: { type: 'string', pattern: '^[0-9a-fA-F]{40}$' },
                        revision: { type: 'integer', minimum: 1 },
                        reason: { type: 'string' },
                        results: {
                          type: 'array',
                          maxItems: 30,
                          items: {
                            type: 'object',
                            required: ['status', 'cwd', 'command'],
                            properties: {
                              status: { type: 'string', enum: ['passed', 'failed'] },
                              cwd: { type: 'string' },
                              command: { type: 'string' },
                            },
                          },
                        },
""",
    label="verification OpenAPI",
)

ORCH.write_text(orch)

gpt = GPT.read_text()

mode_helpers = r'''type ContentTreeEntry = { mode: string; type: string };

export function contentTreeMode(entry?: { mode?: unknown; type?: unknown }): '100644' | '100755' | '120000' {
  if (!entry) return '100644';
  if (
    entry.type !== 'blob' ||
    (entry.mode !== '100644' && entry.mode !== '100755' && entry.mode !== '120000')
  ) {
    throw new ActionError('unsupported_file_mode', 409);
  }
  return entry.mode;
}

async function baseTreeEntries(
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
'''

gpt = replace_once(
    gpt,
    "\nasync function commitFiles(\n",
    "\n" + mode_helpers + "\nasync function commitFiles(\n",
    label="insert tree mode helpers",
)

gpt = replace_once(
    gpt,
    """  const baseCommit = await commitData(client, repositoryName, expectedHeadSha);

  const tree = await Promise.all(
    files.map(async (file) => {
      if (file.content === null) {
        return { path: file.path, mode: '100644', type: 'blob', sha: null };
      }
""",
    """  const baseCommit = await commitData(client, repositoryName, expectedHeadSha);
  const baseEntries = await baseTreeEntries(client, repositoryName, baseCommit.tree.sha);

  const tree = await Promise.all(
    files.map(async (file) => {
      const mode = contentTreeMode(baseEntries.get(file.path));
      if (file.content === null) {
        return { path: file.path, mode, type: 'blob', sha: null };
      }
""",
    label="load base modes",
)

gpt = replace_once(
    gpt,
    "      return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };\n",
    "      return { path: file.path, mode, type: 'blob', sha: blob.sha };\n",
    label="preserve mode in blob entry",
)

GPT.write_text(gpt)

orch_test = ORCH_TEST.read_text()
orch_test = replace_once(
    orch_test,
    """  assert.deepEqual(variants.map((entry: Record<string, any>) => entry.properties.type.enum[0]), [
    'edit',
    'verification',
    'review',
  ]);
});
""",
    """  assert.deepEqual(variants.map((entry: Record<string, any>) => entry.properties.type.enum[0]), [
    'edit',
    'verification',
    'review',
  ]);
  const verification = variants[1];
  assert.deepEqual(verification.required, ['type', 'status', 'headSha', 'revision']);
  assert.deepEqual(verification.properties.results.items.required, ['status', 'cwd', 'command']);
  assert.deepEqual(verification.properties.results.items.properties.status.enum, ['passed', 'failed']);
});
""",
    label="OpenAPI test",
)
ORCH_TEST.write_text(orch_test)

gpt_test = GPT_TEST.read_text()
gpt_test = replace_once(
    gpt_test,
    """  githubBotRequestAllowed,
  githubReadAllowed,
  openApiDocument,
""",
    """  contentTreeMode,
  githubBotRequestAllowed,
  githubReadAllowed,
  openApiDocument,
""",
    label="import mode helper",
)
gpt_test += r'''

test('commit tree mode preserves executable files and symlinks', () => {
  assert.equal(contentTreeMode(undefined), '100644');
  assert.equal(contentTreeMode({ type: 'blob', mode: '100644' }), '100644');
  assert.equal(contentTreeMode({ type: 'blob', mode: '100755' }), '100755');
  assert.equal(contentTreeMode({ type: 'blob', mode: '120000' }), '120000');
  assert.throws(() => contentTreeMode({ type: 'commit', mode: '160000' }));
});
'''
GPT_TEST.write_text(gpt_test)

Path(__file__).unlink()
