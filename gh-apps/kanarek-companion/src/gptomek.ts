import {
  repositoryInstallationId,
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
import {
  GPTOMEK_CONTROL_PULL_REQUEST,
  GPTOMEK_CONTROL_REPOSITORY,
} from './gptomek-control.ts';
import {
  applyUnifiedFilePatch,
  parseUnifiedPatch,
  type UnifiedFilePatch,
} from './gptomek-patch.ts';
import type { CompanionEnv, CompanionTarget, PullRequest } from './companion-types.ts';
import { isObject, type JsonObject, repoPath, REPOSITORY_OWNERS, isProtectedBranch } from './tools/common.ts';

const GITHUB_API = 'https://api.github.com';
const CONTROL_REPOSITORY = GPTOMEK_CONTROL_REPOSITORY;
const CONTROL_PULL_REQUEST = GPTOMEK_CONTROL_PULL_REQUEST;
const COMMAND_RE = /<!--\s*gptomek-command:([A-Za-z0-9+/_-]+={0,2})\s*-->/;
const COMMAND_PREFIX_RE = /<!--\s*gptomek-command:/;
const RESULT_RE = /<!--\s*gptomek-result:([A-Za-z0-9+/_-]+={0,2})\s*-->/g;
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_BATCH_STEPS = 10;
const MAX_RESULT_BYTES = 8_000;
const MAX_PATCH_CHARS = 40_000;
const MAX_PATCH_FILES = 32;
const MAX_PATCHED_FILE_BYTES = 1_000_000;
const MAX_CHERRY_PICK_CHANGES = 512;
const MAX_TREE_MUTATIONS = 512;
const MAX_MOVE_FILES = 256;
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
  'branch_update_not_applied',
  'invalid_branch_ref_response',
  'invalid_commit_response',
  'invalid_created_blob',
  'invalid_created_commit',
  'invalid_created_tree',
  'protected_branch',
]);

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
  mode?: '100644' | '100755';
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

export interface ApplyPatchCommand {
  id: string;
  op: 'apply_patch';
  repository: string;
  branch: string;
  expectedHeadSha: string;
  message: string;
  patch: string;
}

export interface BranchFromPatchCommand {
  id: string;
  op: 'branch_from_patch';
  repository: string;
  branch: string;
  baseSha: string;
  message: string;
  patch: string;
}

export interface ReviewFixCommand {
  id: string;
  op: 'review_fix';
  repository: string;
  pullRequestNumber: number;
  branch: string;
  expectedHeadSha: string;
  commentId: number;
  reviewThreadId?: string;
  message: string;
  patch: string;
  replyBody?: string;
}

export interface RevertCommitCommand {
  id: string;
  op: 'revert_commit';
  repository: string;
  branch: string;
  expectedHeadSha: string;
  commitSha: string;
  message: string;
}

export interface CherryPickCommand {
  id: string;
  op: 'cherry_pick';
  repository: string;
  branch: string;
  expectedHeadSha: string;
  commitSha: string;
  message?: string;
}

type GitObjectMode = '100644' | '100755' | '120000' | '160000';

interface CommitTreeEntrySpec {
  path: string;
  sha: string | null;
  mode?: GitObjectMode;
}

export interface CommitTreeCommand {
  id: string;
  op: 'commit_tree';
  repository: string;
  branch: string;
  expectedHeadSha: string;
  message: string;
  entries: CommitTreeEntrySpec[];
}

interface MoveFileSpec {
  from: string;
  to: string;
}

export interface MoveFilesCommand {
  id: string;
  op: 'move_files';
  repository: string;
  branch: string;
  expectedHeadSha: string;
  message: string;
  moves: MoveFileSpec[];
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
  | ApplyPatchCommand
  | BranchFromPatchCommand
  | ReviewFixCommand
  | RevertCommitCommand
  | CherryPickCommand
  | CommitTreeCommand
  | MoveFilesCommand
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
      REPOSITORY_OWNERS.has(owner) &&
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
  const parts = result.split('/');
  if (
    result.startsWith('/') ||
    result.endsWith('/') ||
    result.endsWith('.') ||
    result.includes('..') ||
    result.includes('//') ||
    parts.includes('.') ||
    parts.some((part) => part.startsWith('.') || part.endsWith('.lock')) ||
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

function gitObjectMode(value: unknown): GitObjectMode {
  const mode = requiredString(value, 'tree_mode', 6);
  if (
    mode !== '100644' &&
    mode !== '100755' &&
    mode !== '120000' &&
    mode !== '160000'
  ) {
    throw new Error('invalid_tree_mode');
  }
  return mode;
}

function gitObjectType(mode: GitObjectMode): 'blob' | 'commit' {
  return mode === '160000' ? 'commit' : 'blob';
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
  // policy evaluation so travnie/* uses the exact same guarded surface.
  const policyPath = target.pathname.replace(/^\/repos\/travnie\//, '/repos/trvny/');
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

  if (op === 'apply_patch') {
    return {
      id,
      op,
      repository: repository(input.repository),
      branch: branch(input.branch),
      expectedHeadSha: sha(input.expectedHeadSha, 'expected_head_sha'),
      message: requiredString(input.message, 'message', 1_000),
      patch: requiredString(input.patch, 'patch', MAX_PATCH_CHARS),
    };
  }

  if (op === 'branch_from_patch') {
    return {
      id,
      op,
      repository: repository(input.repository),
      branch: branch(input.branch),
      baseSha: sha(input.baseSha, 'base_sha'),
      message: requiredString(input.message, 'message', 1_000),
      patch: requiredString(input.patch, 'patch', MAX_PATCH_CHARS),
    };
  }

  if (op === 'review_fix') {
    return {
      id,
      op,
      repository: repository(input.repository),
      pullRequestNumber: positiveInteger(input.pullRequestNumber, 'pull_request_number'),
      branch: branch(input.branch),
      expectedHeadSha: sha(input.expectedHeadSha, 'expected_head_sha'),
      commentId: positiveInteger(input.commentId, 'comment_id'),
      ...(input.reviewThreadId === undefined
        ? {}
        : { reviewThreadId: requiredString(input.reviewThreadId, 'review_thread_id', 200) }),
      message: requiredString(input.message, 'message', 1_000),
      patch: requiredString(input.patch, 'patch', MAX_PATCH_CHARS),
      ...(input.replyBody === undefined
        ? {}
        : { replyBody: requiredString(input.replyBody, 'reply_body', 20_000) }),
    };
  }

  if (op === 'revert_commit') {
    return {
      id,
      op,
      repository: repository(input.repository),
      branch: branch(input.branch),
      expectedHeadSha: sha(input.expectedHeadSha, 'expected_head_sha'),
      commitSha: sha(input.commitSha, 'commit_sha'),
      message: requiredString(input.message, 'message', 1_000),
    };
  }

  if (op === 'cherry_pick') {
    return {
      id,
      op,
      repository: repository(input.repository),
      branch: branch(input.branch),
      expectedHeadSha: sha(input.expectedHeadSha, 'expected_head_sha'),
      commitSha: sha(input.commitSha, 'commit_sha'),
      ...(input.message === undefined
        ? {}
        : { message: requiredString(input.message, 'message', 1_000) }),
    };
  }

  if (op === 'commit_tree') {
    if (
      !Array.isArray(input.entries) ||
      input.entries.length < 1 ||
      input.entries.length > MAX_TREE_MUTATIONS
    ) {
      throw new Error('invalid_tree_entries');
    }
    const entries = input.entries.map((value): CommitTreeEntrySpec => {
      if (!isObject(value)) throw new Error('invalid_tree_entry');
      const entrySha = value.sha === null ? null : sha(value.sha, 'tree_sha');
      return {
        path: filePath(value.path),
        sha: entrySha,
        ...(value.mode === undefined ? {} : { mode: gitObjectMode(value.mode) }),
      };
    });
    if (new Set(entries.map((entry) => entry.path)).size !== entries.length) {
      throw new Error('duplicate_tree_path');
    }
    return {
      id,
      op,
      repository: repository(input.repository),
      branch: branch(input.branch),
      expectedHeadSha: sha(input.expectedHeadSha, 'expected_head_sha'),
      message: requiredString(input.message, 'message', 1_000),
      entries,
    };
  }

  if (op === 'move_files') {
    if (
      !Array.isArray(input.moves) ||
      input.moves.length < 1 ||
      input.moves.length > MAX_MOVE_FILES
    ) {
      throw new Error('invalid_moves');
    }
    const moves = input.moves.map((value): MoveFileSpec => {
      if (!isObject(value)) throw new Error('invalid_move');
      const from = filePath(value.from);
      const to = filePath(value.to);
      if (from === to) throw new Error('move_same_path');
      return { from, to };
    });
    if (new Set(moves.map((move) => move.from)).size !== moves.length) {
      throw new Error('duplicate_move_source');
    }
    if (new Set(moves.map((move) => move.to)).size !== moves.length) {
      throw new Error('duplicate_move_target');
    }
    return {
      id,
      op,
      repository: repository(input.repository),
      branch: branch(input.branch),
      expectedHeadSha: sha(input.expectedHeadSha, 'expected_head_sha'),
      message: requiredString(input.message, 'message', 1_000),
      moves,
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

function refPath(branchName: string): string {
  return branchName.split('/').map(encodeURIComponent).join('/');
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
): Promise<{ message: string; tree: { sha: string }; parents: string[] }> {
  const value = await client.json<{
    message?: string;
    tree?: { sha?: string };
    parents?: Array<{ sha?: string }>;
  }>(
    `/repos/${repoPath(repositoryName)}/git/commits/${commitSha}`,
    'gptomek_get_commit',
  );
  if (!value.tree?.sha || !SHA_RE.test(value.tree.sha)) throw new Error('invalid_commit_response');
  const parents = (value.parents ?? []).map((parent) => parent.sha ?? '');
  if (parents.some((parent) => !SHA_RE.test(parent))) throw new Error('invalid_commit_response');
  return { message: value.message ?? '', tree: { sha: value.tree.sha }, parents };
}

type GitTreeEntryType = 'blob' | 'commit' | 'tree';

interface GitTreeEntry {
  path: string;
  mode: string;
  type: GitTreeEntryType;
  sha: string;
}

interface GitTreeWrite {
  path: string;
  mode: string;
  type: 'blob' | 'commit';
  sha: string | null;
}

function sameTreeEntry(
  left: GitTreeEntry | undefined,
  right: GitTreeEntry | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.mode === right.mode && left.type === right.type && left.sha === right.sha;
}

function writableTreeEntry(entry: GitTreeEntry | undefined): entry is GitTreeEntry & {
  type: 'blob' | 'commit';
} {
  if (!entry) return false;
  if (entry.type === 'blob') {
    return entry.mode === '100644' || entry.mode === '100755' || entry.mode === '120000';
  }
  return entry.type === 'commit' && entry.mode === '160000';
}

async function gitTreeEntries(
  client: GitHubInstallationClient,
  repositoryName: string,
  treeSha: string,
  operation: string,
  errorPrefix: string,
): Promise<Map<string, GitTreeEntry>> {
  const value = await client.json<{
    truncated?: boolean;
    tree?: Array<{
      path?: string;
      mode?: string;
      type?: string;
      sha?: string;
    }>;
  }>(
    `/repos/${repoPath(repositoryName)}/git/trees/${treeSha}?recursive=1`,
    operation,
  );
  if (value.truncated) throw new Error(`${errorPrefix}_tree_too_large`);
  if (!Array.isArray(value.tree)) throw new Error(`${errorPrefix}_invalid_tree`);

  const entries = new Map<string, GitTreeEntry>();
  for (const raw of value.tree) {
    if (
      typeof raw.path !== 'string' ||
      typeof raw.mode !== 'string' ||
      typeof raw.sha !== 'string' ||
      !SHA_RE.test(raw.sha) ||
      (raw.type !== 'blob' && raw.type !== 'commit' && raw.type !== 'tree')
    ) {
      throw new Error(`${errorPrefix}_invalid_tree`);
    }
    entries.set(raw.path, {
      path: raw.path,
      mode: raw.mode,
      type: raw.type,
      sha: raw.sha.toLowerCase(),
    });
  }
  return entries;
}

function fileEntries(entries: Map<string, GitTreeEntry>): Map<string, GitTreeEntry> {
  return new Map([...entries].filter(([, entry]) => entry.type !== 'tree'));
}

function pathParentPrefixes(paths: Iterable<string>): Set<string> {
  const prefixes = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      prefixes.add(parts.slice(0, index).join('/'));
    }
  }
  return prefixes;
}

function fileParentPrefixes(entries: Map<string, GitTreeEntry>): Set<string> {
  return pathParentPrefixes(entries.keys());
}

function hasFileAncestor(entries: Map<string, GitTreeEntry>, path: string): boolean {
  const parts = path.split('/');
  for (let index = 1; index < parts.length; index += 1) {
    if (entries.has(parts.slice(0, index).join('/'))) return true;
  }
  return false;
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
  previousSha: string,
): Promise<void> {
  const observedBeforeUpdate = await branchHead(client, repositoryName, branchName);
  if (observedBeforeUpdate !== previousSha) throw new Error('branch_head_changed');

  try {
    await client.json<unknown>(
      `/repos/${repoPath(repositoryName)}/git/refs/heads/${refPath(branchName)}`,
      'gptomek_update_branch',
      { method: 'PATCH', body: JSON.stringify({ sha: commitSha, force }) },
    );
  } catch (error) {
    let observed: string;
    try {
      observed = await branchHead(client, repositoryName, branchName);
    } catch {
      throw new Error('command_outcome_uncertain');
    }
    if (observed === commitSha) return;
    if (observed === previousSha) {
      if (error instanceof GitHubApiError) throw error;
      throw new Error('branch_update_not_applied');
    }
    throw new Error('command_outcome_uncertain');
  }
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
  await updateBranch(
    client,
    command.repository,
    command.branch,
    newSha,
    true,
    command.expectedHeadSha,
  );
  return { sha: newSha };
}

async function createFileCommit(
  client: GitHubInstallationClient,
  repositoryName: string,
  parentSha: string,
  message: string,
  files: CommitFile[],
): Promise<string> {
  const baseCommit = await commit(client, repositoryName, parentSha);
  const tree = await Promise.all(
    files.map(async (file) => {
      if (file.content === null) {
        return { path: file.path, mode: file.mode ?? '100644', type: 'blob', sha: null };
      }
      const blob = await client.json<{ sha?: string }>(
        `/repos/${repoPath(repositoryName)}/git/blobs`,
        'gptomek_create_blob',
        { method: 'POST', body: JSON.stringify({ content: file.content, encoding: 'utf-8' }) },
      );
      if (!blob.sha || !SHA_RE.test(blob.sha)) throw new Error('invalid_created_blob');
      return { path: file.path, mode: file.mode ?? '100644', type: 'blob', sha: blob.sha };
    }),
  );

  const createdTree = await client.json<{ sha?: string }>(
    `/repos/${repoPath(repositoryName)}/git/trees`,
    'gptomek_create_tree',
    { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }) },
  );
  if (!createdTree.sha || !SHA_RE.test(createdTree.sha)) throw new Error('invalid_created_tree');

  return createCommit(client, repositoryName, message, createdTree.sha, parentSha);
}

async function commitFiles(
  client: GitHubInstallationClient,
  command: CommitFilesCommand,
): Promise<JsonObject> {
  const currentHead = await branchHead(client, command.repository, command.branch);
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');

  const newSha = await createFileCommit(
    client,
    command.repository,
    command.expectedHeadSha,
    command.message,
    command.files,
  );
  await updateBranch(
    client,
    command.repository,
    command.branch,
    newSha,
    false,
    command.expectedHeadSha,
  );
  return { sha: newSha };
}


function encodedFilePath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function decodeBase64Text(value: string): string {
  const normalized = value.replace(/\s/g, '');
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
  } catch {
    throw new Error('invalid_patch_file_content');
  }

  const hasBom =
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf;
  try {
    const decoded = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(hasBom ? bytes.slice(3) : bytes);
    return hasBom ? `\uFEFF${decoded}` : decoded;
  } catch {
    throw new Error('patch_binary_file_not_supported');
  }
}

async function patchFileModes(
  client: GitHubInstallationClient,
  repositoryName: string,
  treeSha: string,
): Promise<Map<string, '100644' | '100755'>> {
  const value = await client.json<{
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; mode?: string }>;
  }>(
    `/repos/${repoPath(repositoryName)}/git/trees/${treeSha}?recursive=1`,
    'gptomek_get_patch_tree',
  );
  if (value.truncated) throw new Error('patch_tree_too_large');

  const modes = new Map<string, '100644' | '100755'>();
  for (const entry of value.tree ?? []) {
    if (entry.type !== 'blob' || typeof entry.path !== 'string') continue;
    if (entry.mode === '100644' || entry.mode === '100755') {
      modes.set(entry.path, entry.mode);
    }
  }
  return modes;
}

async function readPatchFile(
  client: GitHubInstallationClient,
  repositoryName: string,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const value = await client.json<{
      type?: string;
      encoding?: string;
      content?: string;
      size?: number;
    }>(
      `/repos/${repoPath(repositoryName)}/contents/${encodedFilePath(path)}?ref=${encodeURIComponent(ref)}`,
      'gptomek_get_patch_file',
    );
    if (value.type !== 'file' || value.encoding !== 'base64' || typeof value.content !== 'string') {
      throw new Error('patch_file_not_text');
    }
    if (typeof value.size === 'number' && value.size > MAX_PATCHED_FILE_BYTES) {
      throw new Error('patch_file_too_large');
    }
    return decodeBase64Text(value.content);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}

function patchPath(file: UnifiedFilePatch): string {
  const value = file.newPath ?? file.oldPath;
  if (!value) throw new Error('invalid_patch_paths');
  try {
    return filePath(value);
  } catch {
    throw new Error('patch_invalid_path');
  }
}

async function patchedFiles(
  client: GitHubInstallationClient,
  repositoryName: string,
  baseSha: string,
  patch: string,
): Promise<CommitFile[]> {
  const parsed = parseUnifiedPatch(patch);
  if (parsed.length > MAX_PATCH_FILES) throw new Error('too_many_patch_files');

  const baseCommit = await commit(client, repositoryName, baseSha);
  const modes = await patchFileModes(client, repositoryName, baseCommit.tree.sha);
  const files: CommitFile[] = [];
  for (const file of parsed) {
    const path = patchPath(file);
    const existing = await readPatchFile(client, repositoryName, path, baseSha);

    if (file.oldPath === null && existing !== null) throw new Error('patch_target_exists');
    if (file.oldPath !== null && existing === null) throw new Error('patch_target_missing');

    const mode = file.oldPath === null
      ? (file.newMode ?? '100644')
      : modes.get(path);
    if (file.oldPath !== null && !mode) throw new Error('patch_file_mode_not_supported');

    const updated = applyUnifiedFilePatch(existing ?? '', file);
    if (updated !== null && new TextEncoder().encode(updated).byteLength > MAX_PATCHED_FILE_BYTES) {
      throw new Error('patched_file_too_large');
    }
    if (file.oldPath !== null && updated === existing) {
      throw new Error('patch_has_no_changes');
    }
    files.push({ path, content: updated, mode });
  }
  return files;
}

export async function applyPatch(
  client: GitHubInstallationClient,
  command: ApplyPatchCommand,
): Promise<JsonObject> {
  const currentHead = await branchHead(client, command.repository, command.branch);
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');

  const files = await patchedFiles(
    client,
    command.repository,
    command.expectedHeadSha,
    command.patch,
  );
  const result = await commitFiles(client, {
    id: command.id,
    op: 'commit_files',
    repository: command.repository,
    branch: command.branch,
    expectedHeadSha: command.expectedHeadSha,
    message: command.message,
    files,
  });
  return { ...result, files: files.length };
}

async function branchHeadOrNull(
  client: GitHubInstallationClient,
  repositoryName: string,
  branchName: string,
): Promise<string | null> {
  try {
    return await branchHead(client, repositoryName, branchName);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return null;
    throw error;
  }
}

async function createBranchRef(
  client: GitHubInstallationClient,
  repositoryName: string,
  branchName: string,
  commitSha: string,
): Promise<void> {
  if (await branchHeadOrNull(client, repositoryName, branchName)) {
    throw new Error('branch_from_patch_branch_exists');
  }

  try {
    await client.json<unknown>(
      `/repos/${repoPath(repositoryName)}/git/refs`,
      'gptomek_create_branch_ref',
      {
        method: 'POST',
        body: JSON.stringify({
          ref: `refs/heads/${branchName}`,
          sha: commitSha,
        }),
      },
    );
  } catch (error) {
    let observed: string | null;
    try {
      observed = await branchHeadOrNull(client, repositoryName, branchName);
    } catch {
      throw new Error('command_outcome_uncertain');
    }
    if (observed === commitSha) return;
    if (observed === null) {
      if (error instanceof GitHubApiError) throw error;
      throw new Error('branch_create_not_applied');
    }
    throw new Error('command_outcome_uncertain');
  }
}

export async function branchFromPatch(
  client: GitHubInstallationClient,
  command: BranchFromPatchCommand,
): Promise<JsonObject> {
  const repositoryInfo = await client.json<{ default_branch?: unknown }>(
    `/repos/${repoPath(command.repository)}`,
    'gptomek_get_repository',
  );
  const defaultBranch = branch(repositoryInfo.default_branch);
  if (isProtectedBranch(command.branch, defaultBranch)) throw new Error('protected_branch');
  if (await branchHeadOrNull(client, command.repository, command.branch)) {
    throw new Error('branch_from_patch_branch_exists');
  }

  let files: CommitFile[];
  try {
    files = await patchedFiles(client, command.repository, command.baseSha, command.patch);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new Error('branch_from_patch_base_not_found');
    }
    throw error;
  }

  const newSha = await createFileCommit(
    client,
    command.repository,
    command.baseSha,
    command.message,
    files,
  );
  await createBranchRef(client, command.repository, command.branch, newSha);
  return {
    branch: command.branch,
    sha: newSha,
    baseSha: command.baseSha,
    files: files.length,
  };
}

export async function revertCommit(
  client: GitHubInstallationClient,
  command: RevertCommitCommand,
): Promise<JsonObject> {
  const currentHead = await branchHead(client, command.repository, command.branch);
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');
  if (command.commitSha !== command.expectedHeadSha) throw new Error('revert_target_not_head');

  const target = await commit(client, command.repository, command.commitSha);
  if (target.parents.length !== 1) throw new Error('revert_merge_commit_not_supported');
  const parent = await commit(client, command.repository, target.parents[0]);
  if (parent.tree.sha === target.tree.sha) throw new Error('revert_has_no_changes');

  const newSha = await createCommit(
    client,
    command.repository,
    command.message,
    parent.tree.sha,
    command.expectedHeadSha,
  );
  await updateBranch(
    client,
    command.repository,
    command.branch,
    newSha,
    false,
    command.expectedHeadSha,
  );
  return { sha: newSha, reverted: command.commitSha };
}


export async function cherryPick(
  client: GitHubInstallationClient,
  command: CherryPickCommand,
): Promise<JsonObject> {
  const currentHead = await branchHead(client, command.repository, command.branch);
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');
  if (command.commitSha === command.expectedHeadSha) throw new Error('cherry_pick_target_is_head');

  let source: Awaited<ReturnType<typeof commit>>;
  try {
    source = await commit(client, command.repository, command.commitSha);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      throw new Error('cherry_pick_commit_not_found');
    }
    throw error;
  }
  if (source.parents.length !== 1) throw new Error('cherry_pick_merge_commit_not_supported');

  const parent = await commit(client, command.repository, source.parents[0]);
  if (parent.tree.sha === source.tree.sha) throw new Error('cherry_pick_has_no_changes');

  const target = await commit(client, command.repository, command.expectedHeadSha);
  const [parentTree, sourceTree, targetTree] = await Promise.all([
    gitTreeEntries(
      client,
      command.repository,
      parent.tree.sha,
      'gptomek_get_cherry_parent_tree',
      'cherry_pick',
    ),
    gitTreeEntries(
      client,
      command.repository,
      source.tree.sha,
      'gptomek_get_cherry_source_tree',
      'cherry_pick',
    ),
    gitTreeEntries(
      client,
      command.repository,
      target.tree.sha,
      'gptomek_get_cherry_target_tree',
      'cherry_pick',
    ),
  ]);

  const parentFiles = fileEntries(parentTree);
  const sourceFiles = fileEntries(sourceTree);
  const targetFiles = fileEntries(targetTree);
  const parentPrefixes = fileParentPrefixes(parentFiles);
  const sourcePrefixes = fileParentPrefixes(sourceFiles);
  const targetPrefixes = fileParentPrefixes(targetFiles);
  const paths: string[] = [];

  for (const [path, before] of parentFiles) {
    if (!sameTreeEntry(before, sourceFiles.get(path))) paths.push(path);
    if (paths.length > MAX_CHERRY_PICK_CHANGES) {
      throw new Error('cherry_pick_too_many_changes');
    }
  }
  for (const path of sourceFiles.keys()) {
    if (!parentFiles.has(path)) paths.push(path);
    if (paths.length > MAX_CHERRY_PICK_CHANGES) {
      throw new Error('cherry_pick_too_many_changes');
    }
  }
  paths.sort();

  const changes: GitTreeWrite[] = [];
  for (const path of paths) {
    const before = parentFiles.get(path);
    const after = sourceFiles.get(path);
    if (sameTreeEntry(before, after)) continue;

    if ((before && !writableTreeEntry(before)) || (after && !writableTreeEntry(after))) {
      throw new Error('cherry_pick_entry_not_supported');
    }

    if (!before && after && parentPrefixes.has(path)) {
      throw new Error('cherry_pick_structural_change_not_supported');
    }
    if (before && !after && sourcePrefixes.has(path)) {
      throw new Error('cherry_pick_structural_change_not_supported');
    }

    const targetEntry = targetFiles.get(path);
    if (!sameTreeEntry(targetEntry, before)) throw new Error('cherry_pick_conflict');

    if (after) {
      if (hasFileAncestor(targetFiles, path)) throw new Error('cherry_pick_path_conflict');
      if (!before && targetPrefixes.has(path)) {
        throw new Error('cherry_pick_path_conflict');
      }
      changes.push({
        path,
        mode: after.mode,
        type: after.type,
        sha: after.sha,
      });
    } else if (before) {
      changes.push({
        path,
        mode: before.mode,
        type: before.type,
        sha: null,
      });
    }
  }

  if (!changes.length) throw new Error('cherry_pick_has_no_changes');

  const createdTree = await client.json<{ sha?: string }>(
    `/repos/${repoPath(command.repository)}/git/trees`,
    'gptomek_create_tree',
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: target.tree.sha,
        tree: changes,
      }),
    },
  );
  if (!createdTree.sha || !SHA_RE.test(createdTree.sha)) throw new Error('invalid_created_tree');
  if (createdTree.sha.toLowerCase() === target.tree.sha) {
    throw new Error('cherry_pick_has_no_effect');
  }

  const sourceMessage = source.message.trim()
    ? source.message
    : `cherry-pick: ${command.commitSha.slice(0, 12)}`;
  const message = command.message ?? sourceMessage;
  const newSha = await createCommit(
    client,
    command.repository,
    message,
    createdTree.sha,
    command.expectedHeadSha,
  );
  await updateBranch(
    client,
    command.repository,
    command.branch,
    newSha,
    false,
    command.expectedHeadSha,
  );
  return {
    sha: newSha,
    cherryPicked: command.commitSha,
    files: changes.length,
  };
}

export async function commitTree(
  client: GitHubInstallationClient,
  command: CommitTreeCommand,
): Promise<JsonObject> {
  const currentHead = await branchHead(client, command.repository, command.branch);
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');

  const baseCommit = await commit(client, command.repository, command.expectedHeadSha);
  const tree = await gitTreeEntries(
    client,
    command.repository,
    baseCommit.tree.sha,
    'gptomek_get_commit_tree',
    'commit_tree',
  );
  const files = fileEntries(tree);
  const finalFiles = new Map(files);
  const writes = new Map<string, GitTreeWrite>();
  const changedPaths: string[] = [];

  for (const entry of command.entries) {
    const existing = files.get(entry.path);

    if (entry.sha === null) {
      if (entry.mode !== undefined) throw new Error('commit_tree_delete_mode_not_allowed');
      if (!existing) throw new Error('commit_tree_target_missing');
      if (!writableTreeEntry(existing)) throw new Error('commit_tree_entry_not_supported');
      finalFiles.delete(entry.path);
      writes.set(entry.path, {
        path: entry.path,
        mode: existing.mode,
        type: existing.type,
        sha: null,
      });
      continue;
    }

    if (existing && !writableTreeEntry(existing)) {
      throw new Error('commit_tree_entry_not_supported');
    }
    const mode = entry.mode ?? (writableTreeEntry(existing) ? existing.mode as GitObjectMode : undefined);
    if (!mode) throw new Error('commit_tree_mode_required');
    const type = gitObjectType(mode);
    const next: GitTreeEntry = {
      path: entry.path,
      mode,
      type,
      sha: entry.sha,
    };
    finalFiles.set(entry.path, next);
    if (sameTreeEntry(existing, next)) continue;

    writes.set(entry.path, {
      path: entry.path,
      mode,
      type,
      sha: entry.sha,
    });
    changedPaths.push(entry.path);
  }

  if (!writes.size) throw new Error('commit_tree_has_no_changes');

  const finalPrefixes = pathParentPrefixes(finalFiles.keys());
  for (const path of changedPaths) {
    if (hasFileAncestor(finalFiles, path) || finalPrefixes.has(path)) {
      throw new Error('commit_tree_path_conflict');
    }
  }

  const treeWrites = [...writes.values()].sort((left, right) => left.path.localeCompare(right.path));
  const createdTree = await client.json<{ sha?: string }>(
    `/repos/${repoPath(command.repository)}/git/trees`,
    'gptomek_create_tree',
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: treeWrites,
      }),
    },
  );
  if (!createdTree.sha || !SHA_RE.test(createdTree.sha)) throw new Error('invalid_created_tree');
  if (createdTree.sha.toLowerCase() === baseCommit.tree.sha) {
    throw new Error('commit_tree_has_no_effect');
  }

  const newSha = await createCommit(
    client,
    command.repository,
    command.message,
    createdTree.sha,
    command.expectedHeadSha,
  );
  await updateBranch(
    client,
    command.repository,
    command.branch,
    newSha,
    false,
    command.expectedHeadSha,
  );
  return { sha: newSha, entries: treeWrites.length };
}

export async function moveFiles(
  client: GitHubInstallationClient,
  command: MoveFilesCommand,
): Promise<JsonObject> {
  const currentHead = await branchHead(client, command.repository, command.branch);
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');

  const baseCommit = await commit(client, command.repository, command.expectedHeadSha);
  const tree = await gitTreeEntries(
    client,
    command.repository,
    baseCommit.tree.sha,
    'gptomek_get_move_tree',
    'move_files',
  );
  const files = fileEntries(tree);
  const finalFiles = new Map(files);
  const sources = new Map<string, GitTreeEntry>();

  for (const move of command.moves) {
    const source = files.get(move.from);
    if (!source) throw new Error('move_files_source_missing');
    if (!writableTreeEntry(source)) throw new Error('move_files_entry_not_supported');
    sources.set(move.from, source);
    finalFiles.delete(move.from);
  }

  for (const move of command.moves) {
    if (finalFiles.has(move.to)) throw new Error('move_files_target_exists');
    const source = sources.get(move.from);
    if (!source) throw new Error('move_files_source_missing');
    finalFiles.set(move.to, { ...source, path: move.to });
  }

  const finalPrefixes = pathParentPrefixes(finalFiles.keys());
  for (const move of command.moves) {
    if (hasFileAncestor(finalFiles, move.to) || finalPrefixes.has(move.to)) {
      throw new Error('move_files_path_conflict');
    }
  }

  const writes = new Map<string, GitTreeWrite>();
  for (const [path, source] of sources) {
    writes.set(path, {
      path,
      mode: source.mode,
      type: source.type as 'blob' | 'commit',
      sha: null,
    });
  }
  for (const move of command.moves) {
    const source = sources.get(move.from);
    if (!source || !writableTreeEntry(source)) throw new Error('move_files_entry_not_supported');
    writes.set(move.to, {
      path: move.to,
      mode: source.mode,
      type: source.type,
      sha: source.sha,
    });
  }

  const treeWrites = [...writes.values()].sort((left, right) => left.path.localeCompare(right.path));
  const createdTree = await client.json<{ sha?: string }>(
    `/repos/${repoPath(command.repository)}/git/trees`,
    'gptomek_create_tree',
    {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: treeWrites,
      }),
    },
  );
  if (!createdTree.sha || !SHA_RE.test(createdTree.sha)) throw new Error('invalid_created_tree');
  if (createdTree.sha.toLowerCase() === baseCommit.tree.sha) {
    throw new Error('move_files_has_no_effect');
  }

  const newSha = await createCommit(
    client,
    command.repository,
    command.message,
    createdTree.sha,
    command.expectedHeadSha,
  );
  await updateBranch(
    client,
    command.repository,
    command.branch,
    newSha,
    false,
    command.expectedHeadSha,
  );
  return {
    sha: newSha,
    moved: command.moves.length,
    entries: treeWrites.length,
  };
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

export function gptomekReplayCommentSearchPath(path: string): string {
  if (/\/pulls\/\d+\/comments$/.test(path)) {
    return `${path}?sort=created&direction=desc`;
  }
  return path;
}

async function existingMarkedComment(
  client: GitHubInstallationClient,
  path: string,
  id: string,
): Promise<JsonObject | null> {
  const comments = await client.paginate<JsonObject>(
    gptomekReplayCommentSearchPath(path),
    'gptomek_find_existing_comment',
    {
      maxPages: 30,
      stopWhen: (items) => items.some((item) => gptomekReplayCommentMatches(item, id)),
    },
  );
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

interface ReviewFixPullRequest {
  head?: {
    ref?: string;
    sha?: string;
    repo?: { full_name?: string | null } | null;
  };
}

interface ReviewFixThread {
  __typename: 'PullRequestReviewThread';
  id: string;
  isResolved: boolean;
  viewerCanResolve: boolean;
  pullRequest: {
    number: number;
    repository: { nameWithOwner: string };
  };
  comments: {
    nodes: Array<{ databaseId?: number | null }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor?: string | null;
    };
  };
}

interface ReviewFixThreadResponse {
  data?: { node?: ReviewFixThread | null };
  errors?: unknown[];
}

function sameRepository(left: string | null | undefined, right: string): boolean {
  return typeof left === 'string' && left.toLowerCase() === right.toLowerCase();
}

function reviewCommentPullRequestMatches(
  pullRequestUrl: string | undefined,
  command: ReviewFixCommand,
): boolean {
  if (!pullRequestUrl) return false;
  try {
    const url = new URL(pullRequestUrl);
    return (
      url.origin === GITHUB_API &&
      url.pathname.toLowerCase() ===
        `/repos/${command.repository}/pulls/${command.pullRequestNumber}`.toLowerCase()
    );
  } catch {
    return false;
  }
}

async function reviewFixTarget(
  client: GitHubInstallationClient,
  command: ReviewFixCommand,
): Promise<string> {
  const pullRequest = await client.json<ReviewFixPullRequest>(
    `/repos/${repoPath(command.repository)}/pulls/${command.pullRequestNumber}`,
    'gptomek_get_review_fix_pr',
  );
  if (
    pullRequest.head?.ref !== command.branch ||
    !sameRepository(pullRequest.head?.repo?.full_name, command.repository) ||
    typeof pullRequest.head?.sha !== 'string' ||
    !SHA_RE.test(pullRequest.head.sha)
  ) {
    throw new Error('review_fix_pr_head_mismatch');
  }

  const reviewComment = await client.json<{ pull_request_url?: string }>(
    `/repos/${repoPath(command.repository)}/pulls/comments/${command.commentId}`,
    'gptomek_get_review_fix_comment',
  );
  if (!reviewCommentPullRequestMatches(reviewComment.pull_request_url, command)) {
    throw new Error('review_fix_comment_mismatch');
  }
  return pullRequest.head.sha.toLowerCase();
}

async function reviewFixThread(
  client: GitHubInstallationClient,
  command: ReviewFixCommand,
): Promise<ReviewFixThread> {
  if (!command.reviewThreadId) throw new Error('review_fix_thread_id_missing');

  let cursor: string | null = null;
  let metadata: Omit<ReviewFixThread, 'comments'> | null = null;
  for (let page = 0; page < 20; page += 1) {
    const response: ReviewFixThreadResponse = await client.json<ReviewFixThreadResponse>(
      '/graphql',
      'gptomek_get_review_fix_thread',
      {
        method: 'POST',
        body: JSON.stringify({
          query: `query($threadId: ID!, $after: String) {
            node(id: $threadId) {
              ... on PullRequestReviewThread {
                __typename
                id
                isResolved
                viewerCanResolve
                pullRequest {
                  number
                  repository { nameWithOwner }
                }
                comments(first: 100, after: $after) {
                  nodes { databaseId }
                  pageInfo { hasNextPage endCursor }
                }
              }
            }
          }`,
          variables: {
            threadId: command.reviewThreadId,
            after: cursor,
          },
        }),
      },
    );
    if (response.errors?.length || !response.data?.node) {
      throw new Error('review_fix_invalid_thread');
    }

    const thread: ReviewFixThread = response.data.node;
    if (
      thread.__typename !== 'PullRequestReviewThread' ||
      thread.id !== command.reviewThreadId ||
      thread.pullRequest?.number !== command.pullRequestNumber ||
      !sameRepository(thread.pullRequest?.repository?.nameWithOwner, command.repository) ||
      !Array.isArray(thread.comments?.nodes) ||
      !thread.comments?.pageInfo
    ) {
      throw new Error('review_fix_thread_mismatch');
    }

    metadata ??= {
      __typename: thread.__typename,
      id: thread.id,
      isResolved: thread.isResolved,
      viewerCanResolve: thread.viewerCanResolve,
      pullRequest: thread.pullRequest,
    };
    if (thread.comments.nodes.some(
      (comment: { databaseId?: number | null }) =>
        comment.databaseId === command.commentId,
    )) {
      return {
        ...metadata,
        comments: thread.comments,
      };
    }
    if (!thread.comments.pageInfo.hasNextPage) {
      throw new Error('review_fix_thread_mismatch');
    }
    const nextCursor = thread.comments.pageInfo.endCursor;
    if (!nextCursor || nextCursor === cursor) {
      throw new Error('review_fix_thread_pagination_limit');
    }
    cursor = nextCursor;
  }
  throw new Error('review_fix_thread_pagination_limit');
}

async function resolveReviewFixThread(
  client: GitHubInstallationClient,
  command: ReviewFixCommand,
  before?: ReviewFixThread,
): Promise<boolean> {
  if (!command.reviewThreadId) return false;

  const initial = before ?? await reviewFixThread(client, command);
  if (initial.isResolved || !initial.viewerCanResolve) {
    try {
      return (await reviewFixThread(client, command)).isResolved;
    } catch {
      return false;
    }
  }

  try {
    const response = await client.json<{
      data?: { resolveReviewThread?: { thread?: { id?: string; isResolved?: boolean } | null } | null };
      errors?: unknown[];
    }>(
      '/graphql',
      'gptomek_resolve_review_thread',
      {
        method: 'POST',
        body: JSON.stringify({
          query: `mutation($threadId: ID!) {
            resolveReviewThread(input: { threadId: $threadId }) {
              thread { id isResolved }
            }
          }`,
          variables: { threadId: command.reviewThreadId },
        }),
      },
    );
    const resolved = response.data?.resolveReviewThread?.thread;
    if (
      !response.errors?.length &&
      resolved?.id === command.reviewThreadId &&
      resolved.isResolved === true
    ) {
      return true;
    }
  } catch {
    // Thread resolution is optional after patch/reply/reaction have succeeded.
  }

  try {
    return (await reviewFixThread(client, command)).isResolved;
  } catch {
    return false;
  }
}

function reviewFixPatchCommand(command: ReviewFixCommand): ApplyPatchCommand {
  return {
    id: `internal:${command.id}:review-fix:patch`,
    op: 'apply_patch',
    repository: command.repository,
    branch: command.branch,
    expectedHeadSha: command.expectedHeadSha,
    message: command.message,
    patch: command.patch,
  };
}

type ReviewFixPatchCheckpoint =
  | { state: 'missing' | 'recover' | 'in_progress' }
  | { state: 'complete'; sha: string };

async function reviewFixPatchCheckpoint(
  env: CompanionEnv,
  patchCommand: ApplyPatchCommand,
): Promise<ReviewFixPatchCheckpoint> {
  checkpointNamespace(env);
  const operationId = await commandCheckpointId(patchCommand.id);
  const inputHash = await autopilotInputHash(patchCommand as unknown as JsonObject);
  const peek = await checkpointCall(
    env as AutopilotCheckpointEnv,
    operationId,
    '/peek',
    { operationId, inputHash },
  );
  const state = peek.payload.state;
  if (state === 'input_mismatch') {
    throw new Error('command_id_reused_with_different_input');
  }
  if (state === 'uncertain') {
    throw new Error('command_outcome_uncertain');
  }
  if (state === 'complete') {
    const stored = isObject(peek.payload.result) && isObject(peek.payload.result.body)
      ? peek.payload.result.body
      : null;
    const result = stored?.ok === true && isObject(stored.result) ? stored.result : null;
    const shaValue = typeof result?.sha === 'string' && SHA_RE.test(result.sha)
      ? result.sha.toLowerCase()
      : null;
    if (!shaValue) throw new Error('invalid_gptomek_checkpoint_result');
    return { state: 'complete', sha: shaValue };
  }
  if (state === 'missing' || state === 'recover' || state === 'in_progress') {
    return { state };
  }
  throw new Error('invalid_gptomek_checkpoint_result');
}

type ReviewFixStepExecutor = (
  command: NonBatchGptomekCommand,
) => Promise<{ result: unknown; deduplicated: boolean }>;

async function assertReviewFixHead(
  client: GitHubInstallationClient,
  command: ReviewFixCommand,
  expectedSha: string,
): Promise<void> {
  const pullRequest = await client.json<ReviewFixPullRequest>(
    `/repos/${repoPath(command.repository)}/pulls/${command.pullRequestNumber}`,
    'gptomek_verify_review_fix_head',
  );
  if (
    pullRequest.head?.ref !== command.branch ||
    !sameRepository(pullRequest.head?.repo?.full_name, command.repository) ||
    pullRequest.head?.sha?.toLowerCase() !== expectedSha
  ) {
    throw new Error('review_fix_head_changed');
  }
}

export async function reviewFix(
  client: GitHubInstallationClient,
  command: ReviewFixCommand,
  env: CompanionEnv,
  executor?: ReviewFixStepExecutor,
): Promise<JsonObject> {
  const initialPrHead = await reviewFixTarget(client, command);
  const initialThread = command.reviewThreadId
    ? await reviewFixThread(client, command)
    : undefined;

  const patchCommand = reviewFixPatchCommand(command);
  const patchCheckpoint = executor
    ? ({ state: 'missing' } as const)
    : await reviewFixPatchCheckpoint(env, patchCommand);
  if (patchCheckpoint.state === 'in_progress') {
    throw new Error('review_fix_patch_in_progress');
  }
  if (
    patchCheckpoint.state === 'missing' &&
    initialPrHead !== command.expectedHeadSha
  ) {
    throw new Error('review_fix_head_changed');
  }
  if (
    patchCheckpoint.state === 'complete' &&
    initialPrHead !== patchCheckpoint.sha
  ) {
    throw new Error('review_fix_head_changed');
  }

  const run = executor ?? ((step) => executeIdempotent(client, step, env));
  const patch = await run(patchCommand);
  const patchResult = isObject(patch.result) ? patch.result : null;
  const patchSha = typeof patchResult?.sha === 'string' && SHA_RE.test(patchResult.sha)
    ? patchResult.sha.toLowerCase()
    : null;
  if (!patchSha) throw new Error('review_fix_invalid_patch_result');

  let headVerified = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const pullRequestAfter = await client.json<ReviewFixPullRequest>(
      `/repos/${repoPath(command.repository)}/pulls/${command.pullRequestNumber}`,
      'gptomek_get_review_fix_pr_after_patch',
    );
    const head = pullRequestAfter.head;
    if (
      head?.ref !== command.branch ||
      !sameRepository(head?.repo?.full_name, command.repository)
    ) {
      throw new Error('review_fix_head_changed');
    }

    const observedSha = head.sha?.toLowerCase();
    if (observedSha === patchSha) {
      headVerified = true;
      break;
    }
    if (observedSha !== command.expectedHeadSha) {
      throw new Error('review_fix_head_changed');
    }
    if (attempt < 3) await sleep(200);
  }
  if (!headVerified) throw new Error('review_fix_head_changed');

  const replyBody = command.replyBody ?? `Fixed in ${patchSha.slice(0, 12)}.`;
  await assertReviewFixHead(client, command, patchSha);
  const reply = await run({
    id: `internal:${command.id}:review-fix:reply`,
    op: 'reply_review',
    repository: command.repository,
    pullRequestNumber: command.pullRequestNumber,
    commentId: command.commentId,
    body: replyBody,
  });
  await assertReviewFixHead(client, command, patchSha);
  const reaction = await run({
    id: `internal:${command.id}:review-fix:react`,
    op: 'react_review_comment',
    repository: command.repository,
    commentId: command.commentId,
    reaction: '+1',
  });
  if (command.reviewThreadId) {
    await assertReviewFixHead(client, command, patchSha);
  }
  const resolved = await resolveReviewFixThread(client, command, initialThread);

  return {
    sha: patchSha,
    patchDeduplicated: patch.deduplicated,
    replyDeduplicated: reply.deduplicated,
    reactionDeduplicated: reaction.deduplicated,
    resolved,
  };
}

async function executeCommand(
  client: GitHubInstallationClient,
  command: GptomekCommand,
  env: CompanionEnv,
): Promise<unknown> {
  if (command.op === 'adopt_branch') return adoptBranch(client, command);
  if (command.op === 'commit_files') return commitFiles(client, command);
  if (command.op === 'apply_patch') return applyPatch(client, command);
  if (command.op === 'branch_from_patch') return branchFromPatch(client, command);
  if (command.op === 'review_fix') return reviewFix(client, command, env);
  if (command.op === 'revert_commit') return revertCommit(client, command);
  if (command.op === 'cherry_pick') return cherryPick(client, command);
  if (command.op === 'commit_tree') return commitTree(client, command);
  if (command.op === 'move_files') return moveFiles(client, command);
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
  | { state: 'execute'; operationId: string; inputHash: string; recovering: boolean }
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
      return {
        state: 'execute',
        operationId,
        inputHash,
        recovering: state === 'recover',
      };
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

function deterministicPatchFailure(errorValue: string): boolean {
  return (
    errorValue.startsWith('patch_') ||
    errorValue.startsWith('invalid_patch') ||
    errorValue.startsWith('unsupported_patch_') ||
    errorValue === 'empty_patch' ||
    errorValue === 'missing_patch_new_path' ||
    errorValue === 'duplicate_patch_path' ||
    errorValue === 'too_many_patch_files' ||
    errorValue === 'patched_file_too_large' ||
    errorValue === 'delete_patch_did_not_empty_file' ||
    errorValue === 'unexpected_patch_line'
  );
}

function executionFailureSafeToRetry(error: unknown): boolean {
  if (error instanceof GitHubApiError) return true;
  if (!(error instanceof Error)) return false;
  return (
    SAFE_RETRY_ERRORS.has(error.message) ||
    deterministicPatchFailure(error.message) ||
    error.message.startsWith('revert_') ||
    error.message.startsWith('cherry_pick_') ||
    error.message.startsWith('commit_tree_') ||
    error.message.startsWith('move_files_') ||
    error.message.startsWith('branch_from_patch_') ||
    error.message.startsWith('review_fix_')
  );
}

function guardedBranchMutation(command: GptomekCommand): boolean {
  return (
    command.op === 'adopt_branch' ||
    command.op === 'commit_files' ||
    command.op === 'apply_patch' ||
    command.op === 'revert_commit' ||
    command.op === 'cherry_pick' ||
    command.op === 'commit_tree' ||
    command.op === 'move_files'
  );
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
    const recoveredMutationConflict =
      claim.recovering &&
      error instanceof Error &&
      (
        (guardedBranchMutation(command) && error.message === 'branch_head_changed') ||
        (command.op === 'branch_from_patch' && error.message === 'branch_from_patch_branch_exists')
      );
    const ambiguous =
      executionCompleted ||
      recoveredMutationConflict ||
      (command.op !== 'batch' && !executionFailureSafeToRetry(error));
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

export function gptomekMailboxFailureIsTerminal(
  operation: GptomekResultEnvelope['operation'],
  errorValue: string,
): boolean {
  if (
    errorValue === 'operator_action_not_allowed' ||
    errorValue === 'command_id_reused_with_different_input'
  ) {
    return true;
  }

  if (operation === 'adopt_branch') {
    return (
      errorValue === 'branch_head_changed' ||
      errorValue === 'branch_has_no_changes' ||
      errorValue === 'base_is_not_branch_ancestor' ||
      errorValue === 'gptomek_get_branch_ref:404'
    );
  }

  if (operation === 'delete_branch') {
    return errorValue === 'branch_head_changed';
  }

  if (operation === 'apply_patch') {
    return (
      errorValue === 'branch_head_changed' ||
      deterministicPatchFailure(errorValue)
    );
  }

  if (operation === 'branch_from_patch') {
    return (
      errorValue === 'protected_branch' ||
      errorValue.startsWith('branch_from_patch_') ||
      deterministicPatchFailure(errorValue)
    );
  }

  if (operation === 'review_fix') {
    return (
      errorValue === 'branch_head_changed' ||
      errorValue === 'review_fix_pr_head_mismatch' ||
      errorValue === 'review_fix_comment_mismatch' ||
      errorValue === 'review_fix_invalid_thread' ||
      errorValue === 'review_fix_thread_mismatch' ||
      errorValue === 'review_fix_thread_pagination_limit' ||
      errorValue === 'review_fix_thread_not_resolvable' ||
      errorValue === 'review_fix_invalid_patch_result' ||
      errorValue === 'review_fix_head_changed' ||
      deterministicPatchFailure(errorValue)
    );
  }

  if (operation === 'revert_commit') {
    return (
      errorValue === 'branch_head_changed' ||
      errorValue.startsWith('revert_')
    );
  }

  if (operation === 'cherry_pick') {
    return (
      errorValue === 'branch_head_changed' ||
      errorValue.startsWith('cherry_pick_')
    );
  }

  if (operation === 'commit_tree') {
    return (
      errorValue === 'branch_head_changed' ||
      errorValue.startsWith('commit_tree_')
    );
  }

  if (operation === 'move_files') {
    return (
      errorValue === 'branch_head_changed' ||
      errorValue.startsWith('move_files_')
    );
  }

  return false;
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
    const terminal = gptomekMailboxFailureIsTerminal(command.op, errorValue);
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
    // A written error envelope means the mailbox transport worked: the command
    // reached the Worker and its outcome is recorded. Throwing here would turn
    // a command failure into a wake failure and make the Issue relay replay the
    // same command through the #176 fallback. Only an unrecorded outcome is a
    // transport failure.
    if (resultWritten) {
      console.warn(
        JSON.stringify({
          gptomek: terminal ? 'command_rejected' : 'command_failed',
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
