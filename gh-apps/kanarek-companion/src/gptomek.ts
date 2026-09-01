import {
  createAppJwt,
  createInstallationClient,
  GitHubApiError,
  type GitHubInstallationClient,
} from './github-app.ts';
import type { CompanionEnv, CompanionTarget, PullRequest } from './companion-types.ts';

const GITHUB_API = 'https://api.github.com';
const GITHUB_API_VERSION = '2026-03-10';
const CONTROL_REPOSITORY = 'trvny/trvny';
const CONTROL_PULL_REQUEST = 176;
const CONTROL_BRANCH = 'gptomek/control';
const COMMAND_RE = /<!--\s*gptomek-command:([A-Za-z0-9+/_-]+={0,2})\s*-->/;
const COMMAND_PREFIX_RE = /<!--\s*gptomek-command:/;
const SHA_RE = /^[0-9a-f]{40}$/i;
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

interface DeleteBranchCommand {
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

type GptomekCommand =
  | AdoptBranchCommand
  | CommitFilesCommand
  | DeleteBranchCommand
  | CommentCommand
  | ReplyReviewCommand
  | ReactionCommand;

export interface GptomekControlResult {
  control: boolean;
  handled: boolean;
  commandId?: string;
  operation?: GptomekCommand['op'];
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
  if (!gptomekRepositoryAllowed(result)) {
    throw new Error('repository_not_allowed');
  }
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

function parseCommand(value: unknown): GptomekCommand {
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
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('invalid_file');
      }
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

  throw new Error('unsupported_operation');
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
  if (!value.tree?.sha || !SHA_RE.test(value.tree.sha)) {
    throw new Error('invalid_commit_response');
  }
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
    {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitSha, force }),
    },
  );
}

async function adoptBranch(
  client: GitHubInstallationClient,
  command: AdoptBranchCommand,
): Promise<void> {
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
}

async function commitFiles(
  client: GitHubInstallationClient,
  command: CommitFilesCommand,
): Promise<void> {
  const currentHead = await branchHead(client, command.repository, command.branch);
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');
  const baseCommit = await commit(client, command.repository, command.expectedHeadSha);

  const tree = await Promise.all(
    command.files.map(async (file) => {
      if (file.content === null) {
        return { path: file.path, mode: '100644', type: 'blob', sha: null };
      }
      const blob = await client.json<{ sha?: string }>(
        `/repos/${repoPath(command.repository)}/git/blobs`,
        'gptomek_create_blob',
        {
          method: 'POST',
          body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
        },
      );
      if (!blob.sha || !SHA_RE.test(blob.sha)) throw new Error('invalid_created_blob');
      return { path: file.path, mode: '100644', type: 'blob', sha: blob.sha };
    }),
  );

  const createdTree = await client.json<{ sha?: string }>(
    `/repos/${repoPath(command.repository)}/git/trees`,
    'gptomek_create_tree',
    {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    },
  );
  if (!createdTree.sha || !SHA_RE.test(createdTree.sha)) {
    throw new Error('invalid_created_tree');
  }

  const newSha = await createCommit(
    client,
    command.repository,
    command.message,
    createdTree.sha,
    command.expectedHeadSha,
  );
  await updateBranch(client, command.repository, command.branch, newSha, false);
}

export function isProtectedBranch(
  branchName: string,
  defaultBranch: string,
): boolean {
  return (
    branchName.toLowerCase() === 'main' ||
    branchName === defaultBranch ||
    branchName === CONTROL_BRANCH
  );
}

export async function deleteBranch(
  client: GitHubInstallationClient,
  command: DeleteBranchCommand,
): Promise<void> {
  const repositoryInfo = await client.json<{ default_branch?: unknown }>(
    `/repos/${repoPath(command.repository)}`,
    'gptomek_get_repository',
  );
  const defaultBranch = branch(repositoryInfo.default_branch);
  if (isProtectedBranch(command.branch, defaultBranch)) {
    throw new Error('protected_branch');
  }

  let currentHead: string;
  try {
    currentHead = await branchHead(client, command.repository, command.branch);
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) return;
    throw error;
  }
  if (currentHead !== command.expectedHeadSha) throw new Error('branch_head_changed');

  await client.void(
    `/repos/${repoPath(command.repository)}/git/refs/heads/${refPath(command.branch)}`,
    'gptomek_delete_branch',
    { method: 'DELETE' },
  );
}

async function executeCommand(
  client: GitHubInstallationClient,
  command: GptomekCommand,
): Promise<void> {
  if (command.op === 'adopt_branch') return adoptBranch(client, command);
  if (command.op === 'commit_files') return commitFiles(client, command);
  if (command.op === 'delete_branch') return deleteBranch(client, command);

  if (command.op === 'comment') {
    await client.json<unknown>(
      `/repos/${repoPath(command.repository)}/issues/${command.pullRequestNumber}/comments`,
      'gptomek_create_comment',
      { method: 'POST', body: JSON.stringify({ body: command.body }) },
    );
    return;
  }

  if (command.op === 'reply_review') {
    await client.json<unknown>(
      `/repos/${repoPath(command.repository)}/pulls/${command.pullRequestNumber}/comments/${command.commentId}/replies`,
      'gptomek_reply_review',
      { method: 'POST', body: JSON.stringify({ body: command.body }) },
    );
    return;
  }

  const collection = command.op === 'react_review_comment' ? 'pulls/comments' : 'issues/comments';
  await client.json<unknown>(
    `/repos/${repoPath(command.repository)}/${collection}/${command.commentId}/reactions`,
    'gptomek_add_reaction',
    { method: 'POST', body: JSON.stringify({ content: command.reaction }) },
  );
}

export function isGptomekControlPr(
  target: CompanionTarget,
  pr: PullRequest,
): boolean {
  const author = (pr as PullRequest & { user?: { login?: string | null } }).user?.login;
  return (
    target.repository === CONTROL_REPOSITORY &&
    target.pullRequestNumber === CONTROL_PULL_REQUEST &&
    author === 'trvny'
  );
}

export async function handleGptomekControl(
  target: CompanionTarget,
  pr: PullRequest,
  env: CompanionEnv,
  fetcher: typeof fetch = fetch,
): Promise<GptomekControlResult> {
  if (!isGptomekControlPr(target, pr)) return { control: false, handled: false };

  const command = commandFromBody(pr.body);
  if (!command) return { control: true, handled: false };

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
  await executeCommand(commandClient, command);

  await controlClient.json<unknown>(
    `/repos/${repoPath(CONTROL_REPOSITORY)}/pulls/${target.pullRequestNumber}`,
    'gptomek_clear_command',
    {
      method: 'PATCH',
      body: JSON.stringify({ body: withoutCommand(pr.body) }),
    },
  );

  console.log(
    JSON.stringify({
      gptomek: 'command_completed',
      commandId: command.id,
      operation: command.op,
      repository: command.repository,
      installationId: commandInstallationId,
    }),
  );
  return {
    control: true,
    handled: true,
    commandId: command.id,
    operation: command.op,
  };
}
