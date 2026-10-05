import { extractImports, importReferencesTarget, searchSeed } from './dependency-graph.ts';
import { createInstallationClient } from './github-app.ts';
import { createPackageExternalTransport, githubRepositoryFromUrl } from './package-intelligence.ts';
import { inspectRegistryPackage } from './package-registry.ts';
import { type ReviewServiceEnv } from './review-service.ts';
import { likelyTestPath } from './symbol-investigation.ts';
import { repoPath } from './tools/common.ts';

export const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_FILES = 60;
export const MAX_PATCH_CHARS = 14_000;
const MAX_CONTEXT_FILES = 24;
const MAX_CONTEXT_FILE_CHARS = 32_000;
const MAX_CONTEXT_BLOB_BYTES = 192_000;
const MAX_TREE_PATHS = 2_000;
const MAX_TREE_CHARS = 24_000;
const MAX_CALLER_TARGETS = 2;
const MAX_CALLER_CANDIDATES = 6;
const MAX_CALLERS_PER_TARGET = 5;
const MAX_CALLER_CONTENT_BYTES = 300_000;
const MAX_DEPENDENCY_EVIDENCE = 3;
const MAX_RELEASE_NOTES_CHARS = 12_000;
export const runtimeFetch: typeof fetch = (input, init) => fetch(input, init);

const CONTEXT_CONFIG_NAMES = new Set([
  'AGENTS.md',
  'README.md',
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'wrangler.json',
  'wrangler.jsonc',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
]);

const CONTEXT_TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.cs',
  '.css',
  '.cts',
  '.go',
  '.graphql',
  '.gql',
  '.gradle',
  '.h',
  '.hpp',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsonc',
  '.jsx',
  '.kt',
  '.kts',
  '.mjs',
  '.mts',
  '.php',
  '.properties',
  '.ps1',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]);

export interface WebhookReviewEnv extends ReviewServiceEnv {
  COMPANION_LOCK?: DurableObjectNamespace;
  GITHUB_APP_ID: string;
  GITHUB_APP_SLUG?: string;
  GITHUB_PRIVATE_KEY: string;
  KANAREK_REVIEW_JOBS?: DurableObjectNamespace;
  KANAREK_WEBHOOK_REVIEW_ENABLED?: string;
  KANAREK_WEBHOOK_REVIEW_DEBOUNCE_MS?: string;
  KANAREK_WEBHOOK_REVIEW_MAX_CONTEXT_CHARS?: string;
  KANAREK_WEBHOOK_REVIEW_MAX_DIFF_CHARS?: string;
  KANAREK_WEBHOOK_REVIEW_MAX_OUTPUT_TOKENS?: string;
  KANAREK_WEBHOOK_REVIEW_PAID_MAX_CONTEXT_CHARS?: string;
  KANAREK_WEBHOOK_REVIEW_PAID_MAX_DIFF_CHARS?: string;
  KANAREK_WEBHOOK_REVIEW_PAID_MAX_OUTPUT_TOKENS?: string;
  KANAREK_WEBHOOK_REVIEW_DECISION_L2_ENABLED?: string;
  KANAREK_WEBHOOK_REVIEW_JUDGE_ENABLED?: string;
  KANAREK_WEBHOOK_REVIEW_JUDGE_THRESHOLD?: string;
}

export interface PullRequestFile {
  filename?: string;
  patch?: string;
  sha?: string;
}

export interface ReviewFile {
  path: string;
  patch: string;
  rightLines: Set<number>;
  sha: string | null;
}

interface GitTreeEntry {
  path?: string;
  sha?: string;
  size?: number;
  type?: string;
}

interface ReviewContextFile {
  content: string;
  path: string;
  truncated: boolean;
}

export interface ReviewContext {
  files: ReviewContextFile[];
  tree: string[];
  treeTruncated: boolean;
}

export interface RawFinding {
  body?: unknown;
  existing_code?: unknown;
  line?: unknown;
  path?: unknown;
  severity?: unknown;
  title?: unknown;
}

export interface ParsedReview {
  findings: RawFinding[];
  summary: string;
}

export function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function directory(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash) : '';
}

export function containsHan(value: string): boolean {
  return /[\u3400-\u9fff]/u.test(value);
}

export function reviewTextIsChinese(review: ParsedReview): boolean {
  if (review.summary && !containsHan(review.summary)) return false;
  return review.findings.every((finding) => {
    const title = typeof finding.title === 'string' ? finding.title : '';
    const body = typeof finding.body === 'string' ? finding.body : '';
    return containsHan(title) && containsHan(body);
  });
}

export function patchAddedRightLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let rightLine = 0;
  let inHunk = false;

  for (const text of patch.split('\n')) {
    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      rightLine = Number.parseInt(hunk[1], 10);
      inHunk = true;
      continue;
    }
    if (!inHunk || text.startsWith('\\ No newline at end of file')) continue;
    if (text.startsWith('-')) continue;
    if (text.startsWith('+')) {
      lines.add(rightLine);
      rightLine += 1;
      continue;
    }
    if (text.startsWith(' ')) rightLine += 1;
  }
  return lines;
}

export function reviewablePath(path: string): boolean {
  const lower = path.toLowerCase();
  if (
    lower.endsWith('.md') ||
    lower.endsWith('.mdx') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.lock') ||
    lower.endsWith('.min.js') ||
    lower.endsWith('.min.css') ||
    lower.endsWith('package-lock.json') ||
    lower.endsWith('pnpm-lock.yaml') ||
    lower.endsWith('yarn.lock')
  ) {
    return false;
  }
  return !/(^|\/)(dist|vendor|coverage|node_modules)\//.test(lower);
}

function contextEligiblePath(path: string): boolean {
  const lower = path.toLowerCase();
  if (/(^|\/)(dist|vendor|coverage|node_modules|\.git)\//.test(lower)) return false;
  if (
    lower.endsWith('.min.js') ||
    lower.endsWith('.min.css') ||
    lower.endsWith('.map') ||
    lower.endsWith('.lock') ||
    lower.endsWith('package-lock.json') ||
    lower.endsWith('pnpm-lock.yaml') ||
    lower.endsWith('yarn.lock')
  ) {
    return false;
  }
  return (
    CONTEXT_CONFIG_NAMES.has(basename(path)) ||
    CONTEXT_TEXT_EXTENSIONS.has(extension(path))
  );
}

function sharedSegments(left: string, right: string): number {
  const leftSegments = left.split('/');
  const rightSegments = right.split('/');
  const length = Math.min(leftSegments.length, rightSegments.length);
  let shared = 0;
  while (
    shared < length &&
    leftSegments[shared] === rightSegments[shared]
  ) {
    shared += 1;
  }
  return shared;
}

function contextPriority(path: string, changedPaths: readonly string[]): number {
  const name = basename(path);
  const pathDirectory = directory(path);
  let best = 0;
  let sameDirectory = false;
  let ancestorConfig = false;

  for (const changed of changedPaths) {
    const changedDirectory = directory(changed);
    best = Math.max(best, sharedSegments(path, changed));
    if (pathDirectory === changedDirectory) sameDirectory = true;
    if (
      CONTEXT_CONFIG_NAMES.has(name) &&
      (pathDirectory === '' || changed.startsWith(`${pathDirectory}/`))
    ) {
      ancestorConfig = true;
    }
  }

  if (name === 'AGENTS.md' && ancestorConfig) return -300;
  if (ancestorConfig) return -200;
  if (sameDirectory) return -120;
  if (best >= 3) return -80 - best;
  if (best === 2) return -50;
  if (best === 1) return -20;
  if (CONTEXT_CONFIG_NAMES.has(name)) return 20;
  return 100;
}

export function selectReviewFiles(
  files: PullRequestFile[],
  maxDiffChars: number,
  maxPatchChars = MAX_PATCH_CHARS,
): ReviewFile[] {
  const output: ReviewFile[] = [];
  let remaining = maxDiffChars;

  for (const file of files) {
    if (output.length >= MAX_FILES || remaining <= 0) break;
    const path = typeof file.filename === 'string' ? file.filename : '';
    const patch = typeof file.patch === 'string' ? file.patch : '';
    if (!path || !patch || !reviewablePath(path)) continue;

    const clipped = patch.slice(0, Math.min(maxPatchChars, remaining));
    const rightLines = patchAddedRightLines(clipped);
    if (!clipped) continue;
    output.push({
      path,
      patch: clipped,
      rightLines,
      sha:
        typeof file.sha === 'string' && SHA_RE.test(file.sha)
          ? file.sha.toLowerCase()
          : null,
    });
    remaining -= clipped.length;
  }
  return output;
}

export interface ReviewDependencyEvidence {
  ecosystem: 'npm';
  package: string;
  fromVersion: string;
  toVersion: string;
  verified: boolean;
  registryUrl: string | null;
  repository: string | null;
  release: {
    tag: string | null;
    name: string | null;
    url: string | null;
    bodyExcerpt: string | null;
  } | null;
  warning: string | null;
}

interface NpmMajorBump {
  package: string;
  fromVersion: string;
  toVersion: string;
}

function exactSemver(value: string): { normalized: string; major: number } | null {
  const match = value.trim().match(/^[~^]?\s*(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    normalized: `${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
  };
}

export function detectNpmMajorBumps(
  files: Array<Pick<ReviewFile, 'path' | 'patch'>>,
): NpmMajorBump[] {
  const output: NpmMajorBump[] = [];
  const seen = new Set<string>();
  const ignoredKeys = new Set([
    'name',
    'version',
    'private',
    'type',
    'packageManager',
    'description',
    'license',
  ]);

  for (const file of files) {
    if (basename(file.path) !== 'package.json') continue;
    const removed = new Map<string, string>();
    const added = new Map<string, string>();

    for (const line of file.patch.split('\n')) {
      if ((!line.startsWith('-') && !line.startsWith('+')) || line.startsWith('---') || line.startsWith('+++')) {
        continue;
      }
      const match = line.slice(1).match(/^\s*"([^"]+)"\s*:\s*"([^"]+)"\s*,?\s*$/);
      if (!match || ignoredKeys.has(match[1])) continue;
      (line.startsWith('-') ? removed : added).set(match[1], match[2]);
    }

    for (const [name, oldRaw] of removed) {
      const newRaw = added.get(name);
      if (!newRaw || seen.has(name)) continue;
      const oldVersion = exactSemver(oldRaw);
      const newVersion = exactSemver(newRaw);
      if (!oldVersion || !newVersion || newVersion.major <= oldVersion.major) continue;
      seen.add(name);
      output.push({
        package: name,
        fromVersion: oldVersion.normalized,
        toVersion: newVersion.normalized,
      });
      if (output.length >= MAX_DEPENDENCY_EVIDENCE) return output;
    }
  }
  return output;
}

async function releaseEvidence(
  repositoryUrl: string | null,
  version: string,
  transport: ReturnType<typeof createPackageExternalTransport>,
): Promise<ReviewDependencyEvidence['release']> {
  const repository = githubRepositoryFromUrl(repositoryUrl);
  if (!repository) return null;
  const path = `${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}`;
  for (const tag of [`v${version}`, version]) {
    try {
      const raw = objectValue(
        await transport.json(
          `https://api.github.com/repos/${path}/releases/tags/${encodeURIComponent(tag)}`,
          { headers: { accept: 'application/vnd.github+json' } },
        ),
      );
      const body = typeof raw.body === 'string' ? raw.body.trim() : '';
      return {
        tag: typeof raw.tag_name === 'string' ? raw.tag_name : tag,
        name: typeof raw.name === 'string' ? raw.name : null,
        url: typeof raw.html_url === 'string' ? raw.html_url : null,
        bodyExcerpt: body ? body.slice(0, MAX_RELEASE_NOTES_CHARS) : null,
      };
    } catch {
      // Try the common alternate tag form; absence of release notes is not fatal.
    }
  }
  return null;
}

export async function fetchReviewDependencyEvidence(
  files: Array<Pick<ReviewFile, 'path' | 'patch'>>,
  fetcher: typeof fetch = runtimeFetch,
): Promise<ReviewDependencyEvidence[]> {
  const bumps = detectNpmMajorBumps(files);
  if (!bumps.length) return [];
  const transport = createPackageExternalTransport(fetcher, null);
  const output: ReviewDependencyEvidence[] = [];

  for (const bump of bumps) {
    try {
      const registry = await inspectRegistryPackage(
        'npm',
        bump.package,
        bump.toVersion,
        transport.json,
        transport.text,
      );
      const repository = githubRepositoryFromUrl(registry.repositoryUrl);
      output.push({
        ecosystem: 'npm',
        package: bump.package,
        fromVersion: bump.fromVersion,
        toVersion: bump.toVersion,
        verified: registry.selectedVersion === bump.toVersion,
        registryUrl: registry.registryUrl,
        repository: repository ? `${repository.owner}/${repository.repo}` : null,
        release: await releaseEvidence(registry.repositoryUrl, bump.toVersion, transport),
        warning: null,
      });
    } catch (error) {
      output.push({
        ecosystem: 'npm',
        package: bump.package,
        fromVersion: bump.fromVersion,
        toVersion: bump.toVersion,
        verified: false,
        registryUrl: null,
        repository: null,
        release: null,
        warning: error instanceof Error ? error.message.slice(0, 160) : 'dependency_evidence_unavailable',
      });
    }
  }
  return output;
}

export function reviewInputState(
  files: Array<Pick<PullRequestFile, 'filename' | 'patch'>>,
  selectedCount: number,
): 'reviewable' | 'patch_unavailable' | 'no_code_diff' {
  const reviewableFiles = files.filter(
    (file) =>
      typeof file.filename === 'string' && reviewablePath(file.filename),
  );
  const missingPatch = reviewableFiles.some(
    (file) => typeof file.patch !== 'string' || file.patch.length === 0,
  );
  if (missingPatch) return 'patch_unavailable';
  return selectedCount > 0 ? 'reviewable' : 'no_code_diff';
}

export function reviewFileCollectionComplete(
  files: PullRequestFile[],
  maxDiffChars: number,
  maxPatchChars = MAX_PATCH_CHARS,
): boolean {
  const selected = selectReviewFiles(files, maxDiffChars, maxPatchChars);
  if (reviewInputState(files, selected.length) === 'patch_unavailable') {
    return true;
  }
  if (selected.length >= MAX_FILES) return true;
  const selectedChars = selected.reduce(
    (total, file) => total + file.patch.length,
    0,
  );
  return selectedChars >= maxDiffChars;
}

function decodeBase64Text(value: string): string | null {
  try {
    const binary = atob(value.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
  } catch {
    return null;
  }
}

async function fetchBlobText(
  client: Awaited<ReturnType<typeof createInstallationClient>>,
  repository: string,
  sha: string,
): Promise<string | null> {
  const blob = await client.json<{
    content?: string;
    encoding?: string;
  }>(
    `/repos/${repoPath(repository)}/git/blobs/${encodeURIComponent(sha)}`,
    'webhook_review_get_blob',
  );
  return blob.encoding === 'base64' && typeof blob.content === 'string'
    ? decodeBase64Text(blob.content)
    : null;
}

export interface CallerEvidence {
  callers: string[];
  path: string;
  searchIncomplete: boolean;
}

interface CodeSearchItem {
  path?: string;
}

interface CodeSearchResponse {
  incomplete_results?: boolean;
  items?: CodeSearchItem[];
  total_count?: number;
}

interface ContentsResponse {
  content?: string;
  encoding?: string;
  size?: number;
}

async function fetchFileContent(
  client: Awaited<ReturnType<typeof createInstallationClient>>,
  repository: string,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const raw = await client.json<ContentsResponse>(
      `/repos/${repoPath(repository)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
      'webhook_review_get_contents',
    );
    if (raw.encoding !== 'base64' || typeof raw.content !== 'string') return null;
    if (typeof raw.size === 'number' && raw.size > MAX_CALLER_CONTENT_BYTES) return null;
    return decodeBase64Text(raw.content);
  } catch {
    return null;
  }
}

export async function callerEvidenceForFile(
  client: Awaited<ReturnType<typeof createInstallationClient>>,
  repository: string,
  headSha: string,
  path: string,
): Promise<CallerEvidence | null> {
  const seed = searchSeed(path);
  if (!seed) return null;

  let search: CodeSearchResponse;
  try {
    search = await client.json<CodeSearchResponse>(
      `/search/code?q=${encodeURIComponent(`${seed} repo:${repository}`)}&per_page=${MAX_CALLER_CANDIDATES}`,
      'webhook_review_caller_search',
    );
  } catch (error) {
    console.warn( // skipcq: JS-0002 Cloudflare Worker runtime observability.
      JSON.stringify({
        kanarekWebhookReview: 'caller_search_failed',
        path,
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return null;
  }

  const items = Array.isArray(search.items) ? search.items : [];
  const candidates = items
    .map((item) => (typeof item.path === 'string' ? item.path : null))
    .filter((candidatePath): candidatePath is string => Boolean(candidatePath) && candidatePath !== path)
    .slice(0, MAX_CALLER_CANDIDATES);

  const matches = await Promise.all(
    candidates.map(async (candidatePath) => {
      const content = await fetchFileContent(client, repository, candidatePath, headSha);
      if (content === null) return null;
      const references = extractImports(content).some(
        (entry) => importReferencesTarget(candidatePath, entry.specifier, path, entry.syntax) !== null,
      );
      return references ? candidatePath : null;
    }),
  );

  const callers = matches.filter((entry): entry is string => Boolean(entry)).slice(0, MAX_CALLERS_PER_TARGET);
  const totalCount = typeof search.total_count === 'number' ? search.total_count : null;
  return {
    callers,
    path,
    searchIncomplete:
      search.incomplete_results === true ||
      candidates.length < items.length ||
      (totalCount !== null && totalCount > MAX_CALLER_CANDIDATES),
  };
}

export async function fetchCallerEvidence(
  client: Awaited<ReturnType<typeof createInstallationClient>>,
  repository: string,
  headSha: string,
  files: ReviewFile[],
): Promise<CallerEvidence[]> {
  const targets = files.filter((file) => !likelyTestPath(file.path)).slice(0, MAX_CALLER_TARGETS);
  const results = await Promise.all(
    targets.map((file) =>
      callerEvidenceForFile(client, repository, headSha, file.path).catch((error: unknown) => {
        console.warn( // skipcq: JS-0002 Cloudflare Worker runtime observability.
          JSON.stringify({
            kanarekWebhookReview: 'caller_evidence_failed',
            path: file.path,
            error: error instanceof Error ? error.message : 'unknown_error',
          }),
        );
        return null;
      }),
    ),
  );
  return results.filter((entry): entry is CallerEvidence => Boolean(entry));
}

function boundedTree(entries: GitTreeEntry[]): string[] {
  const output: string[] = [];
  let used = 0;
  for (const path of entries
    .map((entry) => entry.path)
    .filter((path): path is string => Boolean(path))
    .sort()) {
    if (output.length >= MAX_TREE_PATHS) break;
    const next = path.length + 1;
    if (used + next > MAX_TREE_CHARS) break;
    output.push(path);
    used += next;
  }
  return output;
}

export async function fetchRepositoryContext(
  client: Awaited<ReturnType<typeof createInstallationClient>>,
  repository: string,
  headSha: string,
  files: ReviewFile[],
  maxChars: number,
): Promise<ReviewContext> {
  let treeEntries: GitTreeEntry[] = [];
  let treeTruncated = false;
  try {
    const tree = await client.json<{ tree?: GitTreeEntry[]; truncated?: boolean }>(
      `/repos/${repoPath(repository)}/git/trees/${encodeURIComponent(headSha)}?recursive=1`,
      'webhook_review_get_tree',
    );
    treeEntries = Array.isArray(tree.tree) ? tree.tree : [];
    treeTruncated = tree.truncated === true;
  } catch (error) {
    console.warn( // skipcq: JS-0002 Cloudflare Worker runtime observability.
      JSON.stringify({
        kanarekWebhookReview: 'tree_unavailable',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
  }

  const tree = boundedTree(treeEntries);
  const changedPaths = files.map((file) => file.path);
  const changedPathSet = new Set(changedPaths);
  const entriesByPath = new Map(
    treeEntries
      .filter((entry): entry is GitTreeEntry & { path: string } =>
        typeof entry.path === 'string',
      )
      .map((entry) => [entry.path, entry] as const),
  );
  const candidates = treeEntries
    .filter((entry) => {
      const path = entry.path ?? '';
      return (
        entry.type === 'blob' &&
        typeof entry.sha === 'string' &&
        typeof entry.size === 'number' &&
        entry.size <= MAX_CONTEXT_BLOB_BYTES &&
        !changedPathSet.has(path) &&
        contextEligiblePath(path)
      );
    })
    .map((entry) => ({
      entry,
      priority: contextPriority(entry.path ?? '', changedPaths),
    }))
    .sort((left, right) => {
      const priority = left.priority - right.priority;
      if (priority !== 0) return priority;
      return (left.entry.size ?? 0) - (right.entry.size ?? 0);
    })
    .map(({ entry }) => entry);

  const contextFiles: ReviewContextFile[] = [];
  let remaining = Math.max(
    0,
    maxChars - JSON.stringify({ tree, treeTruncated }).length,
  );

  const addBlob = async (path: string, sha: string): Promise<void> => {
    if (
      remaining <= 0 ||
      contextFiles.length >= MAX_CONTEXT_FILES ||
      contextFiles.some((item) => item.path === path)
    ) {
      return;
    }
    try {
      const text = await fetchBlobText(client, repository, sha);
      if (text === null) return;
      const limit = Math.min(MAX_CONTEXT_FILE_CHARS, remaining);
      const content = text.slice(0, limit);
      if (!content) return;
      contextFiles.push({
        content,
        path,
        truncated: content.length < text.length,
      });
      remaining -= content.length + path.length + 48;
    } catch (error) {
      console.warn( // skipcq: JS-0002 Cloudflare Worker runtime observability.
        JSON.stringify({
          kanarekWebhookReview: 'context_file_unavailable',
          path,
          error: error instanceof Error ? error.message : 'unknown_error',
        }),
      );
    }
  };

  for (const file of files) {
    const entry = entriesByPath.get(file.path);
    if (
      file.sha &&
      entry?.type === 'blob' &&
      entry.sha === file.sha &&
      typeof entry.size === 'number' &&
      entry.size <= MAX_CONTEXT_BLOB_BYTES
    ) {
      await addBlob(file.path, file.sha);
    }
  }

  for (const entry of candidates) {
    if (remaining <= 0 || contextFiles.length >= MAX_CONTEXT_FILES) break;
    if (entry.path && entry.sha) await addBlob(entry.path, entry.sha);
  }

  return { files: contextFiles, tree, treeTruncated };
}
