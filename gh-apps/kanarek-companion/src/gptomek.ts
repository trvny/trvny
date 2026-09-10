import {
  createAppJwt,
  createInstallationClient,
  GitHubApiError,
  type GitHubInstallationClient,
} from './github-app.ts';
import {
  autopilotInputHash,
  checkpointCall,
  type AutopilotCheckpointEnv,
} from './autopilot-checkpoint.ts';
import { githubBotRequestAllowed } from './gpt-actions.ts';
import type { CompanionEnv, CompanionTarget, PullRequest } from './companion-types.ts';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const CONTROL_REPOSITORY = 'trvny/trvny';
const CONTROL_PULL_REQUEST = 176;
const CONTROL_BRANCH = 'gptomek/control';
const COMMAND_RE = /<!--\s*gptomek-command:([A-Za-z0-9+/_-]+={0,2})\s*-->/;
const COMMAND_PREFIX_RE = /<!--\s*gptomek-command:/;
const RESULT_RE = /<!--\s*gptomek-result:([A-Za-z0-9+/_-]+={0,2})\s*-->/g;
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_BATCH_STEPS = 10;
const MAX_RESULT_BYTES = 8_000;
const ALLOWED_REPOSITORY_OWNERS = new Set(['trvny', 'twojstar']);
const BOT_IDENTITY = {
  name: 'GPTomek',
  email: '314538226+gptomek[bot]@users.noreply.github.com',
};
const REACTIONS = new Set([
  '+1',
  '-1',
  'laugh',
  'confused',
  'heart',
  'hooray',
  'rocket',
  'eyes',
]);
const SAFE_RETRY_ERRORS = new Set([
  'base_is_not_branch_ancestor',
  'branch_has_no_changes',
  'branch_head_changed',
  'invalid_branch_ref_response',
  'invalid_commit_response',
  'invalid_created_blob',
  'invalid_created_commit',
  'invalid_created_tree',
  'protected_branch',
]);

type JsonObject = Record<string, unknown>;
type GptomekTransport = 'issue' | 'pr';

interface GptomekConfig {
  appId: string;
  installationId: number;
  privateKey: string;
}

interface AdoptBranchCommand {
  id: string;
  op: 'adopt_branch';
  repository: string;
  branch: string;
  baseSha: string;
  expectedHeadSha: string;
  message: string;
}

interface CommitFile {
  path: string;
  content: string | null;
}

interface CommitFilesCommand {
  id: string;
  op: 'commit_files';
  repository: string;
  branch: string;
  expectedHeadSha: string;
  message: string;
  files: CommitFile[];
}

export interface DeleteBranchCommand {
  id: string;
  op: 'delete_branch';
  repository: string;
  branch: string;
  expectedHeadSha: string;
}

interface CommentCommand {
  id: string;
  op: 'comment';
  repository: string;
  pullRequestNumber: number;
  body: string;
}

interface ReplyReviewCommand {
  id: string;
  op: 'reply_review';
  repository: string;
  pullRequestNumber: number;
  commentId: number;
  body: string;
}

interface ReactionCommand {
  id: string;
  op: 'react_issue_comment' | 'react_review_comment';
  repository: string;
  commentId: number;
  reaction: string;
}

interface OperatorActionCommand {
  id: string;
  op: 'operator_action';
  repository: string;
  method: string;
  path: string;
  body?: unknown;
  expect: 'json' | 'empty';
}

type NonBatchGptomekCommand =
  | AdoptBranchCommand
  | CommitFilesCommand
  | DeleteBranchCommand
  | CommentCommand
  | ReplyReviewCommand
  | ReactionCommand
  | OperatorActionCommand;

interface BatchCommand {
  id: string;
  op: 'batch';
  repository: string;
  steps: NonBatchGptomekCommand[];
}

type GptomekCommand = NonBatchGptomekCommand | BatchCommand;

export interface GptomekResultEnvelope {
  id: string;
  operation: GptomekCommand['op'];
  repository: string;
  ok: boolean;
  transport: GptomekTransport;
  durationMs: number;
  deduplicated?: boolean;
  result?: unknown;
  error?: string;
}

export interface GptomekControlResult {
  control: boolean;
  handled: boolean;
  commandId?: string;
  operation?: GptomekCommand['op'];
  result?: GptomekResultEnvelope;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requiredString(value: unknown, name: string, max = 65_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}

function positiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error(`invalid_${name}`);
  }
  return value;
}

function sha(value: unknown, name: string): string {
  const result = requiredString(value, name, 40);
  if (!SHA_RE.test(result)) throw new Error(`invalid_${name}`);
  return result.toLowerCase();
}

export function gptomekRepositoryAllowed(value: string): boolean {
  const [owner, repo, extra] = value.split('/');
  return Boolean(
    !extra &&
      owner &&
      ALLOWED_REPOSITORY_OWNERS.has(owner) &&
      repo &&
      /^[A-Za-z0-9_.-]+$/.test(repo),
  );
}

function repository(value: unknown): string {
  const result = requiredString(value, 'repository', 200);
  if (!gptomekRepositoryAllowed(result)) throw new Error('repository_not_allowed');
  return result;
}

function branch(value: unknown): string {
  const result = requiredString(value, 'branch', 250);
  if (
    result.startsWith('/') ||
    result.endsWith('/') ||
    result.includes('..') ||
    result.includes('//') ||
    !/^[A-Za-z0-9._/-]+$/.test(result)
  ) {
    throw new Error('invalid_branch');
  }
  return result;
}

function filePath(value: unknown): string {
  const result = requiredString(value, 'path', 1_000);
  const parts = result.split('/');
  if (
    result.startsWith('/') ||
    result.endsWith('/') ||
    parts.some((part) => !part || part === '.' || part === '..') ||
    parts[0] === '.git'
  ) {
    throw new Error('invalid_path');
  }
  return result;
}

function commandId(value: unknown): string {
  const result = requiredString(value, 'command_id', 100);
  if (!/^[A-Za-z0-9._-]+$/.test(result)) throw new Error('invalid_command_id');
  return result;
}

function normalizeOperatorPath(path: string): URL {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('invalid_github_path');
  const target = new URL(path, GITHUB_API);
  if (target.origin !== GITHUB_API) throw new Error('invalid_github_path');
  return target;
}

function operatorActionNeedsGuardedOperation(
  repositoryName: string,
  methodValue: string,
  target: URL,
): boolean {
  const method = methodValue.toUpperCase();
  const prefix = `/repos/${repositoryName}/`;
  if (!target.pathname.startsWith(prefix)) return false;
  const segments = target.pathname.slice(prefix.length).split('/').filter(Boolean);
  const [root, area, scope] = segments;

  if (root === 'contents' && (method === 'PUT' || method === 'DELETE')) return true;
  if (root === 'git' && area === 'refs') {
    if (method === 'POST' && segments.length === 2) return true;
    if ((method === 'PATCH' || method === 'DELETE') && scope === 'heads' && segments.length >= 4) {
      return true;
    }
  }
  if (root === 'actions' && method === 'POST') {
    if (area === 'runs') return true;
    if (area === 'workflows' && segments.at(-1) === 'dispatches') return true;
  }
  return (
    root === 'releases' &&
    (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE')
  );
}

export function gptomekOperatorActionAllowed(
  repositoryName: string,
  method: string,
  path: string,
  body: unknown = null,
): boolean {
  if (!gptomekRepositoryAllowed(repositoryName)) return false;
  let target: URL;
  try {
    target = normalizeOperatorPath(path);
  } catch {
    return false;
  }
  const prefix = `/repos/${repositoryName}`;
  if (target.pathname !== prefix && !target.pathname.startsWith(`${prefix}/`)) return false;
  if (operatorActionNeedsGuardedOperation(repositoryName, method, target)) return false;

  const [owner] = repositoryName.split('/');
  if (owner === 'trvny') {
    return githubBotRequestAllowed(method, `${target.pathname}${target.search}`, body);
  }

  // GPT Actions keeps the mutation policy rooted at trvny/*. Re-map only for
  // policy evaluation so twojstar/* uses the exact same guarded surface.
  const policyPath = target.pathname.replace(/^\/repos\/twojstar\//, '/repos/trvny/');
  return githubBotRequestAllowed(method, `${policyPath}${target.search}`, body);
}

function parseCommand(value: unknown, nested = false): GptomekCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_command');
  }
  const input = value as Record<string, unknown>;
  const id = commandId(input.id);
  const op = requiredString(input.op, 'operation', 40);

  if (op === 'adopt_branch') {
    return {
      id,
      op,
      repository: repository(input.repository),
      branch: branch(input.branch),
      baseSha: sha(input.baseSha, 'base_sha'),
      expectedHeadSha: sha(input.expectedHeadSha, 'expected_head_sha'),
      message: requiredString(input.message, 'message', 1_000),
    };
  }

  if (op === 'commit_files') {
    if (!Array.isArray(input.files) || !input.files.length || input.files.length > 32) {
      throw new Error('invalid_files');
    }
    const files = input.files.map((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_file');
      const file = value as Record<string, unknown>;
      if (file.content !== null && typeof file.content !== 'string') {
        throw new Error('invalid_file_content');
      }
      if (typeof file.content === 'string' && file.content.length > 48_000) {
        throw new Error('file_content_too_large');
      }
      return { path: filePath(file.path), content: file.content as string | null };
    });
    if (new Set(files.map((file) => file.path)).size !== files.length) {
      throw new Error('duplicate_file_path');
    }
    return {
      id,
      op,
      repository: repository(input.repository),
      branch: branch(input.branch),
      expectedHeadSha: sha(input.expectedHeadSha, 'expected_head_sha'),
      message: requiredString(input.message, 'message', 1_000),
      files,
    };
  }

  if (op === 'delete_branch') {
    return {
      id,
      op,
      repository: repository(input.repository),
      branch: branch(input.branch),
      expectedHeadSha: sha(input.expectedHeadSha, 'expected_head_sha'),
    };
  }

  if (op === 'comment') {
    return {
      id,
      op,
      repository: repository(input.repository),
      pullRequestNumber: positiveInteger(input.pullRequestNumber, 'pull_request_number'),
      body: requiredString(input.body, 'body'),
    };
  }

  if (op === 'reply_review') {
    return {
      id,
      op,
      repository: repository(input.repository),
      pullRequestNumber: positiveInteger(input.pullRequestNumber, 'pull_request_number'),
      commentId: positiveInteger(input.commentId, 'comment_id'),
      body: requiredString(input.body, 'body'),
    };
  }

  if (op === 'react_issue_comment' || op === 'react_review_comment') {
    const reaction = requiredString(input.reaction, 'reaction', 20);
    if (!REACTIONS.has(reaction)) throw new Error('invalid_reaction');
    return {
      id,
      op,
      repository: repository(input.repository),
      commentId: positiveInteger(input.commentId, 'comment_id'),
      reaction,
    };
  }

  if (op === 'operator_action') {
    const repositoryName = repository(input.repository);
    const method = requiredString(input.method, 'method', 10).toUpperCase();
    const path = requiredString(input.path, 'github_path', 2_000);
    const body = input.body;
    return {
      id,
      op,
      repository: repositoryName,
      method,
      path,
      ...(body === undefined ? {} : { body }),
      expect: input.expect === 'empty' || method === 'DELETE' ? 'empty' : 'json',
    };
  }

  if (op === 'batch') {
    if (nested) throw new Error('nested_batch_not_allowed');
    const repositoryName = repository(input.repository);
    if (!Array.isArray(input.steps) || input.steps.length < 1 || input.steps.length > MAX_BATCH_STEPS) {
      throw new Error('invalid_batch_steps');
    }
    if (id.length > 90) throw new Error('batch_command_id_too_long');
    const steps = input.steps.map((step, index): NonBatchGptomekCommand => {
      if (!isObject(step) || step.id !== undefined || step.repository !== undefined) {
        throw new Error('invalid_batch_step');
      }
      const parsed = parseCommand(
        { ...step, id: `${id}.${index + 1}`, repository: repositoryName },
        true,
      );
      if (parsed.op === 'batch') throw new Error('nested_batch_not_allowed');
      return parsed;
    });
    return { id, op, repository: repositoryName, steps };
  }

  throw new Error('unsupported_operation');
}

function validateCommandPolicy(command: GptomekCommand): void {
  if (command.op === 'operator_action') {
    if (
      !gptomekOperatorActionAllowed(
        command.repository,
        command.method,
        command.path,
        command.body,
      )
    ) {
      throw new Error('operator_action_not_allowed');
    }
    return;
  }
  if (command.op === 'batch') {
    for (const step of command.steps) validateCommandPolicy(step);
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/g, '');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return new TextDecoder().decode(
    Uint8Array.from(atob(normalized + padding), (character) => character.charCodeAt(0)),
  );
}

export function encodeGptomekCommand(command: unknown): string {
  const json = JSON.stringify(command);
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function commandMarker(command: unknown): string {
  return `<!-- gptomek-command:${encodeGptomekCommand(command)} -->`;
}

export function resultMarker(result: GptomekResultEnvelope): string {
  return `<!-- gptomek-result:${encodeGptomekCommand(result)} -->`;
}

function commandFromBody(body: string | null | undefined): GptomekCommand | null {
  if (!body) return null;
  const match = body.match(COMMAND_RE);
  if (!match) {
    if (COMMAND_PREFIX_RE.test(body)) throw new Error('invalid_command_encoding');
    return null;
  }
  const remainder = body.replace(match[0], '');
  if (COMMAND_PREFIX_RE.test(remainder)) throw new Error('invalid_command_encoding');

  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeBase64Url(match[1]));
  } catch {
    throw new Error('invalid_command_encoding');
  }
  return parseCommand(decoded);
}

function withoutCommand(body: string | null | undefined): string {
  return (body ?? '').replace(COMMAND_RE, '').replace(/\n{3,}/g, '\n\n').trim();
}

function bodyWithResult(
  body: string | null | undefined,
  result: GptomekResultEnvelope,
  removeCommand: boolean,
): string {
  const clean = (removeCommand ? withoutCommand(body) : (body ?? '').trim()).replace(RESULT_RE, '').trim();
  return [clean, resultMarker(result)].filter(Boolean).join('\n\n');
}

function config(env: CompanionEnv): GptomekConfig {
  const appId = requiredString(env.GPTOMEK_APP_ID, 'gptomek_app_id', 30);
  const privateKey = requiredString(env.GPTOMEK_PRIVATE_KEY, 'gptomek_private_key', 20_000);
  const installationId = Number(env.GPTOMEK_INSTALLATION_ID);
  if (!Number.isInteger(installationId) || installationId <= 0) {
    throw new Error('invalid_gptomek_installation_id');
  }
  return { appId, privateKey, installationId };
}

function repoPath(repositoryName: string): string {
  return repositoryName
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function refPath(branchName: string): string {
  return encodeURIComponent(branchName);
}

async function repositoryInstallationId(
  appId: string,
  privateKey: string,
  repositoryName: string,
  fetcher: typeof fetch,
): Promise<number> {
  const jwt = await createAppJwt(appId, privateKey);
  const response = await fetcher(
    `${GITHUB_API}/repos/${repoPath(repositoryName)}/installation`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'User-Agent': 'kanarek-companion',
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw new GitHubApiError('gptomek_get_repository_installation', response.status);
  }
  const payload = (await response.json()) as { id?: unknown };
  return positiveInteger(payload.id, 'repository_installation_id');
}

async function branchHead(
  client: GitHubInstallationClient,
  repositoryName: string,
  branchName: string,
): Promise<string> {
  const ref = await client.json<{ object?: { sha?: string } }>(
    `/repos/${repoPath(repositoryName)}/git/ref/heads/${refPath(branchName)}`,
    'gptomek_get_branch_ref',
  );
  const value = ref.object?.sha;
  if (!value || !SHA_RE.test(value)) throw new Error('invalid_branch_ref_response');
  return value.toLowerCase();
}

async function commit(
  client: GitHubInstallationClient,
  repositoryName: string,
  commitSha: string,
): Promise<{ message: string; tree: { sha: string } }> {
  const value = await client.json<{ message?: string; tree?: { sha?: string } }>(
    `/repos/${repoPath(repositoryName)}/git/commits/${commitSha}`,
    'gptomek_get_commit',
  );
  if (!value.tree?.sha || !SHA_RE.test(value.tree.sha)) throw new Error('invalid_commit_response');
  return { message: value.message ?? '', tree: { sha: value.tree.sha } };
}

async function createCommit(
  client: GitHubInstallationClient,
  repositoryName: string,
  message: string,
  treeSha: string,
  parentSha: string,
): Promise<string> {
  const created = await client.json<{ sha?: string }>(
    `/repos/${repoPath(repositoryName)}/git/commits`,
    'gptomek_create_commit',
    {
      method: 'POST',
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [parentSha],
        author: BOT_IDENTITY,
        committer: BOT_IDENTITY,
      }),
    },
  );
  if (!created.sha || !SHA_RE.test(created.sha)) throw new Error('invalid_created_commit');
  return created.sha.toLowerCase();
}

async function updateBranch(
  client: GitHubInstallationClient,
  repositoryName: string,
  branchName: string,
  commitSha: string,
  force: boolean,
): Promise<void> {
  await client.json<unknown>(
    `/repos/${repoPath(repositoryName)}/git/refs/heads/${refPath(branchName)}`,
    'gptomek_update_branch',
    { method: 'PATCH', body: JSON.stringify({ sha: commitSha, force }) },
  );
}

async function adoptBranch(
  client: GitHubInstallationClient,
  command: AdoptBranchCommand,
): Promise<JsonObject> {
  const currentHead = await branchHead(client, command.repository, command.branch);
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');
  if (command.baseSha === command.expectedHeadSha) throw new Error('branch_has_no_changes');

  const comparison = await client.json<{ status?: string; ahead_by?: number }>(
    `/repos/${repoPath(command.repository)}/compare/${command.baseSha}...${command.expectedHeadSha}`,
    'gptomek_compare_branch',
  );
  if (comparison.status !== 'ahead' || !comparison.ahead_by) {
    throw new Error('base_is_not_branch_ancestor');
  }

  const headCommit = await commit(client, command.repository, command.expectedHeadSha);
  const newSha = await createCommit(
    client,
    command.repository,
    command.message,
    headCommit.tree.sha,
    command.baseSha,
  );
  await updateBranch(client, command.repository, command.branch, newSha, true);
  return { sha: newSha };
}

async function commitFiles(
  client: GitHubInstallationClient,
  command: CommitFilesCommand,
): Promise<JsonObject> {
  const currentHead = await branchHead(client, command.repository, command.branch);
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');
  const baseCommit = await commit(client, command.repository, command.expectedHeadSha);

  const tree = await Promise.all(
    command.files.map(async (file) => {
      if (file.content === null) return { path: file.path, mode: '100644', type: 'blob', sha: null };
      const blob = await client.json<{ sha?: string }>(
        `/repos/${repoPath(command.repository)}/git/blobs`,
        'gptomek_create_blob',
        { method: 'POST', body: JSON.stringify({ content: file.content, encoding: 'utf-8' }) },
      );
      if (!blob.sha || !SHA_RE.test(blob.sha)) throw new Error('invalid_created_blob');
      return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };
    }),
  );

  const createdTree = await client.json<{ sha?: string }>(
    `/repos/${repoPath(command.repository)}/git/trees`,
    'gptomek_create_tree',
    { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }) },
  );
  if (!createdTree.sha || !SHA_RE.test(createdTree.sha)) throw new Error('invalid_created_tree');

  const newSha = await createCommit(
    client,
    command.repository,
    command.message,
    createdTree.sha,
    command.expectedHeadSha,
  );
  await updateBranch(client, command.repository, command.branch, newSha, false);
  return { sha: newSha };
}

export function isProtectedBranch(branchName: string, defaultBranch: string): boolean {
  return (
    branchName.toLowerCase() === 'main' ||
    branchName === defaultBranch ||
    branchName === CONTROL_BRANCH
  );
}

export async function deleteBranch(
  client: GitHubInstallationClient,
  command: DeleteBranchCommand,
): Promise<JsonObject> {
  const repositoryInfo = await client.json<{ default_branch?: unknown }>(
    `/repos/${repoPath(command.repository)}`,
    'gptomek_get_repository',
  );
  const defaultBranch = branch(repositoryInfo.default_branch);
  if (isProtectedBranch(command.branch, defaultBranch)) throw new Error('protected_branch');

  let currentHead: string;
  try {
    currentHead = await branchHead(client, command.repository, command.branch);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return { deleted: false, missing: true };
    throw error;
  }
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');

  await client.void(
    `/repos/${repoPath(command.repository)}/git/refs/heads/${refPath(command.branch)}`,
    'gptomek_delete_branch',
    { method: 'DELETE' },
  );
  return { deleted: true };
}

function idempotencyMarker(id: string): string {
  return `<!-- gptomek-id:${id} -->`;
}

function markedBody(body: string, id: string): string {
  const marker = idempotencyMarker(id);
  return body.includes(marker) ? body : `${body}\n\n${marker}`;
}

export function gptomekReplayCommentMatches(item: JsonObject, id: string): boolean {
  const marker = idempotencyMarker(id);
  const user = isObject(item.user) ? item.user : null;
  return (
    typeof item.body === 'string' &&
    item.body.includes(marker) &&
    user?.login === 'gptomek[bot]'
  );
}

async function existingMarkedComment(
  client: GitHubInstallationClient,
  path: string,
  id: string,
): Promise<JsonObject | null> {
  const comments = await client.paginate<JsonObject>(path, 'gptomek_find_existing_comment', {
    maxPages: 5,
    stopWhen: (items) => items.some((item) => gptomekReplayCommentMatches(item, id)),
  });
  return comments.find((item) => gptomekReplayCommentMatches(item, id)) ?? null;
}

function compactResult(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    const encoded = JSON.stringify(value);
    if (encoded.length <= MAX_RESULT_BYTES) return value;
    return { truncated: true, bytes: encoded.length };
  } catch {
    return { truncated: true, reason: 'non_serializable_result' };
  }
}

async function executeCommand(
  client: GitHubInstallationClient,
  command: GptomekCommand,
  env: CompanionEnv,
): Promise<unknown> {
  if (command.op === 'adopt_branch') return adoptBranch(client, command);
  if (command.op === 'commit_files') return commitFiles(client, command);
  if (command.op === 'delete_branch') return deleteBranch(client, command);

  if (command.op === 'comment') {
    const path = `/repos/${repoPath(command.repository)}/issues/${command.pullRequestNumber}/comments`;
    const existing = await existingMarkedComment(client, path, command.id);
    if (existing) return compactResult(existing);
    return compactResult(
      await client.json<unknown>(path, 'gptomek_create_comment', {
        method: 'POST',
        body: JSON.stringify({ body: markedBody(command.body, command.id) }),
      }),
    );
  }

  if (command.op === 'reply_review') {
    const listPath = `/repos/${repoPath(command.repository)}/pulls/${command.pullRequestNumber}/comments`;
    const existing = await existingMarkedComment(client, listPath, command.id);
    if (existing) return compactResult(existing);
    return compactResult(
      await client.json<unknown>(
        `/repos/${repoPath(command.repository)}/pulls/${command.pullRequestNumber}/comments/${command.commentId}/replies`,
        'gptomek_reply_review',
        {
          method: 'POST',
          body: JSON.stringify({ body: markedBody(command.body, command.id) }),
        },
      ),
    );
  }

  if (command.op === 'react_issue_comment' || command.op === 'react_review_comment') {
    const collection = command.op === 'react_review_comment' ? 'pulls/comments' : 'issues/comments';
    return compactResult(
      await client.json<unknown>(
        `/repos/${repoPath(command.repository)}/${collection}/${command.commentId}/reactions`,
        'gptomek_add_reaction',
        { method: 'POST', body: JSON.stringify({ content: command.reaction }) },
      ),
    );
  }

  if (command.op === 'operator_action') {
    if (command.expect === 'empty') {
      await client.void(command.path, 'gptomek_operator_action', {
        method: command.method,
        body: command.body === undefined ? undefined : JSON.stringify(command.body),
      });
      return { ok: true };
    }
    return compactResult(
      await client.json<unknown>(command.path, 'gptomek_operator_action', {
        method: command.method,
        body: command.body === undefined ? undefined : JSON.stringify(command.body),
      }),
    );
  }

  if (command.op === 'batch') {
    const results: JsonObject[] = [];
    for (const step of command.steps) {
      const execution = await executeIdempotent(client, step, env);
      results.push({
        id: step.id,
        operation: step.op,
        deduplicated: execution.deduplicated,
        result: execution.result,
      });
    }
    return { count: results.length, steps: results };
  }

  throw new Error('unsupported_operation');
}

function checkpointNamespace(env: CompanionEnv): DurableObjectNamespace {
  const namespace = (env as CompanionEnv & { OPERATOR_CHECKPOINTS?: DurableObjectNamespace }).OPERATOR_CHECKPOINTS;
  if (!namespace) throw new Error('gptomek_checkpoint_not_configured');
  return namespace;
}

async function commandCheckpointId(commandIdValue: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(commandIdValue));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `op-gptomek-${hex.slice(0, 48)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimCheckpoint(
  env: CompanionEnv,
  command: GptomekCommand,
): Promise<
  | { state: 'execute'; operationId: string; inputHash: string }
  | { state: 'complete'; result: unknown }
> {
  checkpointNamespace(env);
  const operationId = await commandCheckpointId(command.id);
  const inputHash = await autopilotInputHash(command as unknown as JsonObject);
  const checkpointEnv = env as AutopilotCheckpointEnv;

  for (let attempt = 0; attempt < 17; attempt += 1) {
    const claim = await checkpointCall(checkpointEnv, operationId, '/claim', { operationId, inputHash });
    const state = claim.payload.state;
    const progress = isObject(claim.payload.progress) ? claim.payload.progress : null;
    if (state === 'recover' && progress?.gptomekOutcome === 'uncertain') {
      throw new Error('command_outcome_uncertain');
    }
    if (state === 'claimed' || state === 'recover') {
      return { state: 'execute', operationId, inputHash };
    }
    if (state === 'complete') {
      const stored = isObject(claim.payload.result) && isObject(claim.payload.result.body)
        ? claim.payload.result.body
        : null;
      if (stored?.ok === false && stored.uncertain === true) {
        throw new Error('command_outcome_uncertain');
      }
      if (!stored || stored.ok !== true) throw new Error('invalid_gptomek_checkpoint_result');
      return { state: 'complete', result: stored.result ?? null };
    }
    if (state === 'input_mismatch') throw new Error('command_id_reused_with_different_input');
    if (state !== 'in_progress') throw new Error('invalid_gptomek_checkpoint_claim');
    if (attempt < 16) await sleep(250);
  }
  throw new Error('command_in_progress');
}

async function markCheckpointUncertain(
  env: AutopilotCheckpointEnv,
  operationId: string,
  inputHash: string,
): Promise<void> {
  try {
    const completed = await checkpointCall(env, operationId, '/complete', {
      inputHash,
      status: 409,
      body: { ok: false, uncertain: true, error: 'command_outcome_uncertain' },
    });
    if (completed.response.ok) return;
  } catch {
    // Fall through to a recoverable progress marker if the completion response
    // itself was lost.
  }
  try {
    await checkpointCall(env, operationId, '/progress', {
      inputHash,
      progress: { gptomekOutcome: 'uncertain' },
    });
  } catch {
    // Do not release the lease. If the checkpoint store is temporarily down,
    // retaining the running claim is safer than making a duplicate write easy.
  }
}

function executionFailureSafeToRetry(error: unknown): boolean {
  if (error instanceof GitHubApiError) return true;
  return error instanceof Error && SAFE_RETRY_ERRORS.has(error.message);
}

async function executeIdempotent(
  client: GitHubInstallationClient,
  command: GptomekCommand,
  env: CompanionEnv,
): Promise<{ result: unknown; deduplicated: boolean }> {
  const claim = await claimCheckpoint(env, command);
  if (claim.state === 'complete') return { result: claim.result, deduplicated: true };

  const checkpointEnv = env as AutopilotCheckpointEnv;
  let executionCompleted = false;
  try {
    const result = compactResult(await executeCommand(client, command, env));
    executionCompleted = true;
    const completed = await checkpointCall(checkpointEnv, claim.operationId, '/complete', {
      inputHash: claim.inputHash,
      status: 200,
      body: { ok: true, result },
    });
    if (!completed.response.ok) {
      await markCheckpointUncertain(checkpointEnv, claim.operationId, claim.inputHash);
      throw new Error('command_outcome_uncertain');
    }
    return { result, deduplicated: false };
  } catch (error) {
    if (error instanceof Error && error.message === 'command_outcome_uncertain') throw error;
    const ambiguous =
      executionCompleted || (command.op !== 'batch' && !executionFailureSafeToRetry(error));
    if (ambiguous) {
      await markCheckpointUncertain(checkpointEnv, claim.operationId, claim.inputHash);
      throw new Error('command_outcome_uncertain');
    }
    try {
      await checkpointCall(checkpointEnv, claim.operationId, '/release', { inputHash: claim.inputHash });
    } catch {
      // Preserve the original operation error. A retained lease is safer than
      // hiding it with checkpoint cleanup noise.
    }
    throw error;
  }
}

function transportFromPath(clearPath: string): GptomekTransport {
  return clearPath.includes('/issues/') ? 'issue' : 'pr';
}

function errorCode(error: unknown): string {
  if (error instanceof GitHubApiError) return `${error.operation}:${error.status}`;
  if (error instanceof Error) return error.message.slice(0, 500);
  return 'unknown_error';
}

export function isGptomekControlPr(target: CompanionTarget, pr: PullRequest): boolean {
  const author = (pr as PullRequest & { user?: { login?: string | null } }).user?.login;
  return (
    target.repository === CONTROL_REPOSITORY &&
    target.pullRequestNumber === CONTROL_PULL_REQUEST &&
    author === 'trvny'
  );
}

export async function handleGptomekMailboxCommand(
  body: string | null | undefined,
  clearPath: string,
  env: CompanionEnv,
  fetcher: typeof fetch = fetch,
): Promise<GptomekControlResult> {
  const command = commandFromBody(body);
  if (!command) return { control: true, handled: false };

  const startedAt = Date.now();
  const transport = transportFromPath(clearPath);
  const settings = config(env);
  const controlClient = await createInstallationClient(
    settings.appId,
    settings.privateKey,
    settings.installationId,
    fetcher,
  );
  const commandInstallationId = await repositoryInstallationId(
    settings.appId,
    settings.privateKey,
    command.repository,
    fetcher,
  );
  const commandClient =
    commandInstallationId === settings.installationId
      ? controlClient
      : await createInstallationClient(
          settings.appId,
          settings.privateKey,
          commandInstallationId,
          fetcher,
        );

  try {
    validateCommandPolicy(command);
    const execution = await executeIdempotent(commandClient, command, env);
    const envelope: GptomekResultEnvelope = {
      id: command.id,
      operation: command.op,
      repository: command.repository,
      ok: true,
      transport,
      durationMs: Date.now() - startedAt,
      deduplicated: execution.deduplicated,
      result: execution.result,
    };
    await controlClient.json<unknown>(clearPath, 'gptomek_clear_command', {
      method: 'PATCH',
      body: JSON.stringify({ body: bodyWithResult(body, envelope, true) }),
    });

    console.log(
      JSON.stringify({
        gptomek: 'command_completed',
        commandId: command.id,
        operation: command.op,
        repository: command.repository,
        installationId: commandInstallationId,
        transport,
        deduplicated: execution.deduplicated,
        durationMs: envelope.durationMs,
      }),
    );
    return {
      control: true,
      handled: true,
      commandId: command.id,
      operation: command.op,
      result: envelope,
    };
  } catch (error) {
    const errorValue = errorCode(error);
    const uncertain = errorValue === 'command_outcome_uncertain';
    const terminal = errorValue === 'operator_action_not_allowed';
    const envelope: GptomekResultEnvelope = {
      id: command.id,
      operation: command.op,
      repository: command.repository,
      ok: false,
      transport,
      durationMs: Date.now() - startedAt,
      error: errorValue,
    };
    let resultWritten = false;
    try {
      await controlClient.json<unknown>(clearPath, 'gptomek_write_error_result', {
        method: 'PATCH',
        body: JSON.stringify({
          body: bodyWithResult(body, envelope, uncertain || terminal),
        }),
      });
      resultWritten = true;
    } catch (resultError) {
      console.error(
        JSON.stringify({
          gptomek: 'result_write_failed',
          commandId: command.id,
          failure: errorCode(resultError),
        }),
      );
    }
    if (terminal && resultWritten) {
      console.warn(
        JSON.stringify({
          gptomek: 'command_rejected',
          commandId: command.id,
          operation: command.op,
          repository: command.repository,
          error: errorValue,
          transport,
        }),
      );
      return {
        control: true,
        handled: true,
        commandId: command.id,
        operation: command.op,
        result: envelope,
      };
    }
    throw error;
  }
}

export async function handleGptomekControl(
  target: CompanionTarget,
  pr: PullRequest,
  env: CompanionEnv,
  fetcher: typeof fetch = fetch,
): Promise<GptomekControlResult> {
  if (!isGptomekControlPr(target, pr)) return { control: false, handled: false };
  return handleGptomekMailboxCommand(
    pr.body,
    `/repos/${repoPath(CONTROL_REPOSITORY)}/pulls/${target.pullRequestNumber}`,
    env,
    fetcher,
  );
}
