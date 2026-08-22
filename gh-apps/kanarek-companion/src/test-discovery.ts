import { likelyTestPath } from './symbol-investigation.ts';

export const TARGETED_TESTS_PATH = '/gpt-actions/github/code/tests';

const READ_PATH = '/gpt-actions/github/read';
const SHA_RE = /^[0-9a-f]{40}$/i;
const MAX_TARGETS = 12;
const MAX_ANCESTORS = 8;
const MAX_TEST_CANDIDATES = 64;
const MAX_CONTENT_BYTES = 300_000;

type JsonObject = Record<string, unknown>;
type Invoke = (request: Request) => Promise<Response>;
export type ProjectKind = 'node' | 'gradle' | 'python' | 'rust' | 'go';
type CommandKind = 'test' | 'typecheck' | 'lint' | 'build' | 'check';
type CommandScope = 'targeted' | 'project';

type Input = {
  repository: string;
  targetPaths: string[];
  ref?: string;
};

export type VerificationCommand = {
  cwd: string;
  command: string;
  kind: CommandKind;
  scope: CommandScope;
  confidence: 'high' | 'medium';
  reason: string;
};

type Project = {
  root: string;
  kind: ProjectKind;
  marker: string;
  targets: string[];
};

class TestDiscoveryError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = 'TestDiscoveryError';
    this.code = code;
    this.status = status;
  }
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function repository(value: unknown): string {
  if (typeof value !== 'string' || !/^trvny\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new TestDiscoveryError('repository_not_allowed', 403);
  }
  return value;
}

function validPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value) &&
    value.length <= 600 &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.includes('..') &&
    !value.includes('//') &&
    value.split('/').every((part) => part && part !== '.' && part !== '..')
  );
}

function targetPaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TARGETS) {
    throw new TestDiscoveryError('invalid_target_paths');
  }
  const paths = value.map((entry) => {
    if (!validPath(entry)) throw new TestDiscoveryError('invalid_target_paths');
    return entry;
  });
  if (new Set(paths).size !== paths.length) throw new TestDiscoveryError('invalid_target_paths');
  return paths;
}

function refAllowed(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 200) return false;
  if (SHA_RE.test(value)) return true;
  if (
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.startsWith('-') ||
    value.includes('..') ||
    value.includes('//') ||
    value.includes('@{') ||
    /[~^:?*\[\\\s]/.test(value)
  ) {
    return false;
  }
  return value.split('/').every((part) => part && part !== '.' && !part.endsWith('.lock'));
}

function optionalRef(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (!refAllowed(value)) throw new TestDiscoveryError('invalid_ref');
  return value;
}

async function inputObject(request: Request): Promise<Input> {
  const text = await request.clone().text();
  if (text.length > 16_000) throw new TestDiscoveryError('payload_too_large', 413);
  let value: unknown = {};
  try {
    if (text.trim()) value = JSON.parse(text);
  } catch {
    throw new TestDiscoveryError('invalid_json');
  }
  if (!isObject(value)) throw new TestDiscoveryError('invalid_json_object');
  const allowed = new Set(['repository', 'targetPaths', 'ref']);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TestDiscoveryError('invalid_test_discovery_request');
  }
  return {
    repository: repository(value.repository),
    targetPaths: targetPaths(value.targetPaths),
    ref: optionalRef(value.ref),
  };
}

function internalRequest(source: Request, path: string): Request {
  const url = new URL(source.url);
  url.pathname = READ_PATH;
  url.search = '';
  const headers = new Headers(source.headers);
  headers.set('content-type', 'application/json');
  headers.delete('content-length');
  return new Request(url, { method: 'POST', headers, body: JSON.stringify({ path }) });
}

async function responseObject(response: Response): Promise<JsonObject> {
  let value: unknown;
  try {
    value = await response.clone().json();
  } catch {
    throw new TestDiscoveryError('invalid_action_response', 502);
  }
  if (!isObject(value)) throw new TestDiscoveryError('invalid_action_response', 502);
  if (!response.ok || value.ok !== true) {
    throw new TestDiscoveryError(
      typeof value.error === 'string' ? value.error : `read_${response.status}`,
      response.status,
    );
  }
  return value;
}

async function readData(source: Request, invoke: Invoke, path: string): Promise<unknown> {
  return (await responseObject(await invoke(internalRequest(source, path)))).data;
}

async function readOptional(source: Request, invoke: Invoke, path: string): Promise<unknown | null> {
  try {
    return await readData(source, invoke, path);
  } catch (error) {
    if (error instanceof TestDiscoveryError && error.status === 404) return null;
    throw error;
  }
}

function repoPath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function filePath(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function dirname(value: string): string {
  const normalized = normalizePath(value);
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? '' : normalized.slice(0, slash);
}

function basename(value: string): string {
  const normalized = normalizePath(value);
  const slash = normalized.lastIndexOf('/');
  return slash < 0 ? normalized : normalized.slice(slash + 1);
}

function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join('/'));
}

function relativeToRoot(root: string, path: string): string {
  const normalized = normalizePath(path);
  if (!root) return normalized;
  return normalized === root ? '' : normalized.slice(root.length + 1);
}

function displayRoot(root: string): string {
  return root || '.';
}

function ancestors(path: string): string[] {
  const result: string[] = [];
  let current = dirname(path);
  for (let index = 0; index < MAX_ANCESTORS; index += 1) {
    if (!result.includes(current)) result.push(current);
    if (!current) break;
    current = dirname(current);
  }
  if (!result.includes('')) result.push('');
  return result.slice(0, MAX_ANCESTORS);
}

function directoryNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((entry): entry is JsonObject => isObject(entry) && typeof entry.name === 'string')
    .map((entry) => String(entry.name));
}

export function detectProjectKind(names: string[]): { kind: ProjectKind; marker: string } | null {
  const set = new Set(names);
  if (set.has('package.json')) return { kind: 'node', marker: 'package.json' };
  if (set.has('gradlew') || set.has('settings.gradle') || set.has('settings.gradle.kts')) {
    return {
      kind: 'gradle',
      marker: set.has('gradlew') ? 'gradlew' : set.has('settings.gradle.kts') ? 'settings.gradle.kts' : 'settings.gradle',
    };
  }
  if (set.has('Cargo.toml')) return { kind: 'rust', marker: 'Cargo.toml' };
  if (set.has('go.mod')) return { kind: 'go', marker: 'go.mod' };
  for (const marker of ['pyproject.toml', 'pytest.ini', 'tox.ini', 'setup.cfg']) {
    if (set.has(marker)) return { kind: 'python', marker };
  }
  return null;
}

function decodeText(value: unknown): string | null {
  if (!isObject(value) || value.encoding !== 'base64' || typeof value.content !== 'string') return null;
  if (typeof value.size === 'number' && value.size > MAX_CONTENT_BYTES) return null;
  try {
    const binary = atob(value.content.replace(/\s/g, ''));
    if (binary.length > MAX_CONTENT_BYTES) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function resolveSnapshot(
  source: Request,
  invoke: Invoke,
  input: Input,
): Promise<{ defaultBranch: string; requestedRef: string; resolvedSha: string }> {
  const repo = repoPath(input.repository);
  const repositoryRaw = await readData(source, invoke, `/repos/${repo}`);
  if (!isObject(repositoryRaw) || typeof repositoryRaw.default_branch !== 'string') {
    throw new TestDiscoveryError('invalid_repository_response', 502);
  }
  const requestedRef = input.ref ?? repositoryRaw.default_branch;
  const commitRaw = await readData(
    source,
    invoke,
    `/repos/${repo}/commits/${encodeURIComponent(requestedRef)}`,
  );
  if (!isObject(commitRaw) || typeof commitRaw.sha !== 'string' || !SHA_RE.test(commitRaw.sha)) {
    throw new TestDiscoveryError('invalid_ref_response', 502);
  }
  return {
    defaultBranch: repositoryRaw.default_branch,
    requestedRef,
    resolvedSha: commitRaw.sha.toLowerCase(),
  };
}

async function findProjects(
  source: Request,
  invoke: Invoke,
  repositoryName: string,
  sha: string,
  paths: string[],
): Promise<{ projects: Project[]; unresolved: string[] }> {
  const repo = repoPath(repositoryName);
  const cache = new Map<string, Promise<string[] | null>>();
  const namesFor = (directory: string): Promise<string[] | null> => {
    const existing = cache.get(directory);
    if (existing) return existing;
    const apiPath = directory
      ? `/repos/${repo}/contents/${filePath(directory)}?ref=${encodeURIComponent(sha)}`
      : `/repos/${repo}/contents?ref=${encodeURIComponent(sha)}`;
    const pending = readOptional(source, invoke, apiPath).then(directoryNames);
    cache.set(directory, pending);
    return pending;
  };

  const located = await Promise.all(
    paths.map(async (path) => {
      for (const directory of ancestors(path)) {
        const names = await namesFor(directory);
        if (!names) continue;
        const detected = detectProjectKind(names);
        if (detected) return { path, root: directory, ...detected };
      }
      return { path, root: null, kind: null, marker: null };
    }),
  );

  const grouped = new Map<string, Project>();
  const unresolved: string[] = [];
  for (const item of located) {
    if (item.root === null || item.kind === null || item.marker === null) {
      unresolved.push(item.path);
      continue;
    }
    const key = `${item.kind}:${item.root}`;
    const current = grouped.get(key);
    if (current) current.targets.push(item.path);
    else grouped.set(key, { root: item.root, kind: item.kind, marker: item.marker, targets: [item.path] });
  }
  return { projects: [...grouped.values()], unresolved };
}

function stemAndExtension(path: string): { stem: string; extension: string } {
  const name = basename(path);
  const match = name.match(/^(.*?)(\.[^.]+)$/);
  return match ? { stem: match[1], extension: match[2] } : { stem: name, extension: '' };
}

export function conventionalTestCandidates(
  projectRoot: string,
  targetPath: string,
  kind: ProjectKind,
): string[] {
  if (likelyTestPath(targetPath)) return [normalizePath(targetPath)];
  const target = normalizePath(targetPath);
  const directory = dirname(target);
  const relative = relativeToRoot(projectRoot, target);
  const { stem, extension } = stemAndExtension(target);
  const candidates = new Set<string>();

  if (kind === 'node' && /\.(?:[cm]?[jt]sx?)$/i.test(extension)) {
    for (const suffix of ['test', 'spec']) {
      candidates.add(joinPath(directory, `${stem}.${suffix}${extension}`));
      candidates.add(joinPath(projectRoot, 'test', `${stem}.${suffix}${extension}`));
      candidates.add(joinPath(projectRoot, 'tests', `${stem}.${suffix}${extension}`));
    }
    if (relative.startsWith('src/')) {
      const sourceRelative = relative.slice('src/'.length);
      const sourceDir = dirname(sourceRelative);
      const sourceStem = stemAndExtension(sourceRelative).stem;
      for (const suffix of ['test', 'spec']) {
        candidates.add(joinPath(projectRoot, 'test', sourceDir, `${sourceStem}.${suffix}${extension}`));
        candidates.add(joinPath(projectRoot, 'tests', sourceDir, `${sourceStem}.${suffix}${extension}`));
      }
    }
  } else if (kind === 'python' && extension === '.py') {
    candidates.add(joinPath(directory, `test_${stem}.py`));
    candidates.add(joinPath(projectRoot, 'tests', `test_${stem}.py`));
    candidates.add(joinPath(projectRoot, 'test', `test_${stem}.py`));
  } else if (kind === 'gradle' && /\.(?:kt|java)$/i.test(extension)) {
    const replacements = [
      ['src/main/kotlin/', 'src/test/kotlin/'],
      ['src/main/java/', 'src/test/java/'],
    ];
    for (const [mainPrefix, testPrefix] of replacements) {
      const marker = relative.indexOf(mainPrefix);
      if (marker < 0) continue;
      const tail = relative.slice(marker + mainPrefix.length);
      const tailDir = dirname(tail);
      const classStem = stemAndExtension(tail).stem;
      candidates.add(joinPath(projectRoot, relative.slice(0, marker), testPrefix, tailDir, `${classStem}Test${extension}`));
    }
  } else if (kind === 'go' && extension === '.go') {
    candidates.add(joinPath(directory, `${stem}_test.go`));
  } else if (kind === 'rust' && extension === '.rs') {
    candidates.add(joinPath(projectRoot, 'tests', `${stem}.rs`));
  }

  return [...candidates].filter((candidate) => candidate && candidate !== target).slice(0, 10);
}

async function existingTests(
  source: Request,
  invoke: Invoke,
  repositoryName: string,
  sha: string,
  project: Project,
): Promise<string[]> {
  const repo = repoPath(repositoryName);
  const candidates = new Set<string>();
  for (const target of project.targets) {
    for (const candidate of conventionalTestCandidates(project.root, target, project.kind)) {
      if (candidates.size >= MAX_TEST_CANDIDATES) break;
      candidates.add(candidate);
    }
  }
  const checked = await Promise.all(
    [...candidates].map(async (candidate) => {
      if (project.targets.includes(candidate) && likelyTestPath(candidate)) return candidate;
      const raw = await readOptional(
        source,
        invoke,
        `/repos/${repo}/contents/${filePath(candidate)}?ref=${encodeURIComponent(sha)}`,
      );
      return isObject(raw) ? candidate : null;
    }),
  );
  return checked.filter((path): path is string => Boolean(path));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function command(
  root: string,
  raw: string,
  kind: CommandKind,
  scope: CommandScope,
  reason: string,
  confidence: 'high' | 'medium' = 'high',
): VerificationCommand {
  return { cwd: displayRoot(root), command: raw, kind, scope, confidence, reason };
}

function dedupeCommands(commands: VerificationCommand[]): VerificationCommand[] {
  const seen = new Set<string>();
  return commands.filter((item) => {
    const key = `${item.cwd}:${item.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function codeTargets(project: Project): boolean {
  return project.targets.some((path) => /\.(?:[cm]?[jt]sx?|kt|kts|java|py|go|rs|swift)$/i.test(path));
}

function parsePackageScripts(content: string | null): Record<string, string> {
  if (!content) return {};
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isObject(parsed) || !isObject(parsed.scripts)) return {};
    return Object.fromEntries(
      Object.entries(parsed.scripts)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function directNodeRunner(scripts: Record<string, string>): string | null {
  const keys = Object.keys(scripts)
    .filter((key) => key === 'test' || key.startsWith('test:'))
    .sort((left, right) => {
      if (left === 'test:raw') return -1;
      if (right === 'test:raw') return 1;
      if (left === 'test') return 1;
      if (right === 'test') return -1;
      return left.localeCompare(right);
    });
  for (const key of keys) {
    const script = scripts[key];
    if (/\btsx\s+--test\b/.test(script)) return 'npx tsx --test';
    if (/\bnode\s+--test\b/.test(script)) return 'node --test';
    if (/\bvitest\b/.test(script)) return 'npx vitest run';
    if (/\bjest\b/.test(script)) return 'npx jest';
  }
  return null;
}

function nodeVerification(
  project: Project,
  packageContent: string | null,
  tests: string[],
): { recommended: VerificationCommand[]; gate: VerificationCommand[]; evidence: string[] } {
  const scripts = parsePackageScripts(packageContent);
  const recommended: VerificationCommand[] = [];
  const gate: VerificationCommand[] = [];
  const runner = directNodeRunner(scripts);
  const relativeTests = tests.map((path) => relativeToRoot(project.root, path));

  if (relativeTests.length && runner) {
    recommended.push(
      command(
        project.root,
        `${runner} ${relativeTests.map(shellQuote).join(' ')}`,
        'test',
        'targeted',
        'Run only conventionally matched test files with the project test runner.',
      ),
    );
  } else {
    const testScript = scripts['test:raw'] ? 'test:raw' : scripts.test ? 'test' : null;
    if (testScript) {
      recommended.push(
        command(
          project.root,
          testScript === 'test' ? 'npm test' : `npm run ${testScript}`,
          'test',
          'project',
          relativeTests.length
            ? 'Test files were found, but the package script could not be safely narrowed to file arguments.'
            : 'No direct test file was confidently mapped; use the smallest configured test script.',
          'medium',
        ),
      );
    }
  }

  if (scripts.typecheck && codeTargets(project)) {
    recommended.push(
      command(project.root, 'npm run typecheck', 'typecheck', 'project', 'Changed code is covered by the configured typecheck script.'),
    );
  }
  if (scripts.lint && codeTargets(project)) {
    recommended.push(
      command(project.root, 'npm run lint', 'lint', 'project', 'Changed code is covered by the configured lint script.'),
    );
  }

  const relativeTargets = project.targets.map((path) => relativeToRoot(project.root, path));
  for (const key of Object.keys(scripts).filter((name) => name.startsWith('build:'))) {
    const scope = key.slice('build:'.length).toLowerCase();
    if (!scope) continue;
    if (relativeTargets.some((path) => path.toLowerCase().split('/').includes(scope))) {
      recommended.push(
        command(project.root, `npm run ${key}`, 'build', 'project', `Changed files fall inside the ${scope} build scope.`),
      );
    }
  }

  if (scripts.check) {
    gate.push(command(project.root, 'npm run check', 'check', 'project', 'Configured project-wide validation gate.'));
  } else {
    for (const [name, kind] of [
      ['typecheck', 'typecheck'],
      ['lint', 'lint'],
      ['test', 'test'],
      ['build', 'build'],
    ] as const) {
      if (!scripts[name]) continue;
      gate.push(
        command(project.root, name === 'test' ? 'npm test' : `npm run ${name}`, kind, 'project', 'Configured project-wide validation command.'),
      );
    }
  }

  return {
    recommended: dedupeCommands(recommended),
    gate: dedupeCommands(gate),
    evidence: Object.keys(scripts).sort().map((name) => `package.json#scripts.${name}`),
  };
}

function gradleTestClass(projectRoot: string, testPath: string): string | null {
  const relative = relativeToRoot(projectRoot, testPath);
  const match = relative.match(/(?:^|\/)src\/test\/(?:kotlin|java)\/(.+)\.(?:kt|java)$/i);
  return match ? match[1].replace(/\//g, '.') : null;
}

function gradleVerification(
  project: Project,
  buildContent: string | null,
  tests: string[],
): { recommended: VerificationCommand[]; gate: VerificationCommand[]; evidence: string[] } {
  const android = Boolean(buildContent && /com\.android\.(?:application|library)/.test(buildContent));
  const task = android ? 'testDebugUnitTest' : 'test';
  const classes = tests.map((path) => gradleTestClass(project.root, path)).filter((value): value is string => Boolean(value));
  const testCommand = classes.length
    ? `./gradlew ${task} ${classes.map((value) => `--tests ${shellQuote(value)}`).join(' ')}`
    : `./gradlew ${task}`;
  return {
    recommended: [
      command(
        project.root,
        testCommand,
        'test',
        classes.length ? 'targeted' : 'project',
        classes.length ? 'Run only matched JVM test classes.' : 'Use the nearest project test task; no test class was confidently mapped.',
        classes.length ? 'high' : 'medium',
      ),
    ],
    gate: [command(project.root, './gradlew check', 'check', 'project', 'Gradle project-wide verification gate.')],
    evidence: [project.marker, ...(buildContent ? ['build.gradle(.kts)'] : [])],
  };
}

function pythonVerification(
  project: Project,
  configContent: string | null,
  tests: string[],
): { recommended: VerificationCommand[]; gate: VerificationCommand[]; evidence: string[] } {
  const recommended: VerificationCommand[] = [];
  const gate: VerificationCommand[] = [];
  const relativeTests = tests.map((path) => relativeToRoot(project.root, path));
  const pytestConfigured = Boolean(configContent && /pytest|\[tool\.pytest/i.test(configContent));
  if (relativeTests.length) {
    recommended.push(
      command(project.root, `python -m pytest ${relativeTests.map(shellQuote).join(' ')}`, 'test', 'targeted', 'Run conventionally matched Python tests.'),
    );
  } else if (pytestConfigured) {
    recommended.push(command(project.root, 'python -m pytest', 'test', 'project', 'Pytest is configured, but no direct test file was mapped.', 'medium'));
  }
  if (configContent && /\[tool\.mypy\]/.test(configContent)) {
    recommended.push(command(project.root, 'python -m mypy .', 'typecheck', 'project', 'mypy is configured in project metadata.'));
  }
  if (configContent && /\[tool\.ruff\]/.test(configContent)) {
    recommended.push(command(project.root, 'python -m ruff check .', 'lint', 'project', 'Ruff is configured in project metadata.'));
  }
  if (pytestConfigured || relativeTests.length) {
    gate.push(command(project.root, 'python -m pytest', 'test', 'project', 'Project-wide Python test gate.'));
  }
  return { recommended, gate, evidence: [project.marker] };
}

function rustVerification(
  project: Project,
  tests: string[],
): { recommended: VerificationCommand[]; gate: VerificationCommand[]; evidence: string[] } {
  const integrationTests = tests
    .map((path) => relativeToRoot(project.root, path).match(/^tests\/(.+)\.rs$/)?.[1] ?? null)
    .filter((value): value is string => Boolean(value));
  const raw = integrationTests.length
    ? `cargo test ${integrationTests.map((name) => `--test ${shellQuote(name)}`).join(' ')}`
    : 'cargo test';
  return {
    recommended: [command(project.root, raw, 'test', integrationTests.length ? 'targeted' : 'project', integrationTests.length ? 'Run matched Rust integration tests.' : 'Compile and run the nearest crate tests.', integrationTests.length ? 'high' : 'medium')],
    gate: [command(project.root, 'cargo test --all-targets', 'test', 'project', 'Crate-wide Rust verification gate.')],
    evidence: [project.marker],
  };
}

function goVerification(project: Project): {
  recommended: VerificationCommand[];
  gate: VerificationCommand[];
  evidence: string[];
} {
  const packages = new Set(
    project.targets.map((path) => {
      const relative = relativeToRoot(project.root, dirname(path));
      return relative ? `./${relative}` : '.';
    }),
  );
  return {
    recommended: [...packages].map((pkg) => command(project.root, `go test ${pkg}`, 'test', 'targeted', 'Run tests for changed Go packages.')),
    gate: [command(project.root, 'go test ./...', 'test', 'project', 'Module-wide Go verification gate.')],
    evidence: [project.marker],
  };
}

async function projectFile(
  source: Request,
  invoke: Invoke,
  repositoryName: string,
  sha: string,
  root: string,
  names: string[],
): Promise<{ path: string; content: string | null } | null> {
  const repo = repoPath(repositoryName);
  for (const name of names) {
    const path = joinPath(root, name);
    const raw = await readOptional(
      source,
      invoke,
      `/repos/${repo}/contents/${filePath(path)}?ref=${encodeURIComponent(sha)}`,
    );
    if (!raw) continue;
    return { path, content: decodeText(raw) };
  }
  return null;
}

async function analyzeProject(
  source: Request,
  invoke: Invoke,
  repositoryName: string,
  sha: string,
  project: Project,
): Promise<JsonObject> {
  const tests = await existingTests(source, invoke, repositoryName, sha, project);
  let verification: { recommended: VerificationCommand[]; gate: VerificationCommand[]; evidence: string[] };
  let manifestPath = joinPath(project.root, project.marker);

  if (project.kind === 'node') {
    const manifest = await projectFile(source, invoke, repositoryName, sha, project.root, ['package.json']);
    manifestPath = manifest?.path ?? manifestPath;
    verification = nodeVerification(project, manifest?.content ?? null, tests);
  } else if (project.kind === 'gradle') {
    const build = await projectFile(source, invoke, repositoryName, sha, project.root, ['build.gradle.kts', 'build.gradle']);
    verification = gradleVerification(project, build?.content ?? null, tests);
  } else if (project.kind === 'python') {
    const config = await projectFile(source, invoke, repositoryName, sha, project.root, ['pyproject.toml', 'pytest.ini', 'tox.ini', 'setup.cfg']);
    manifestPath = config?.path ?? manifestPath;
    verification = pythonVerification(project, config?.content ?? null, tests);
  } else if (project.kind === 'rust') {
    verification = rustVerification(project, tests);
  } else {
    verification = goVerification(project);
  }

  return {
    root: displayRoot(project.root),
    kind: project.kind,
    marker: project.marker,
    manifestPath,
    targets: project.targets,
    discoveredTests: tests,
    commands: verification.recommended,
    projectGate: verification.gate,
    evidence: verification.evidence,
  };
}

async function discoverTests(source: Request, invoke: Invoke): Promise<Response> {
  const input = await inputObject(source);
  const snapshot = await resolveSnapshot(source, invoke, input);
  const located = await findProjects(
    source,
    invoke,
    input.repository,
    snapshot.resolvedSha,
    input.targetPaths,
  );
  const projects = await Promise.all(
    located.projects.map((project) => analyzeProject(source, invoke, input.repository, snapshot.resolvedSha, project)),
  );
  const recommendedCommands = dedupeCommands(
    projects.flatMap((project) => Array.isArray(project.commands) ? project.commands.filter(isObject) as VerificationCommand[] : []),
  );
  const discoveredTests = projects.flatMap((project) =>
    Array.isArray(project.discoveredTests)
      ? project.discoveredTests.filter((value): value is string => typeof value === 'string')
      : [],
  );

  return json({
    ok: true,
    repository: {
      name: input.repository,
      defaultBranch: snapshot.defaultBranch,
      requestedRef: snapshot.requestedRef,
      resolvedRefSha: snapshot.resolvedSha,
    },
    targetPaths: input.targetPaths,
    summary: {
      projects: projects.length,
      unresolvedTargets: located.unresolved.length,
      discoveredTests: discoveredTests.length,
      recommendedCommands: recommendedCommands.length,
    },
    projects,
    unresolvedTargets: located.unresolved,
    recommendedCommands,
    finalGate: {
      ciRequired: true,
      note: 'Run normal repository CI on the final head after targeted verification; targeted commands are an optimization, not a replacement for CI.',
    },
  });
}

function objectResponse(description: string): JsonObject {
  return {
    description,
    content: { 'application/json': { schema: { type: 'object', properties: {} } } },
  };
}

export function addTargetedTestsOpenApi(document: JsonObject): void {
  if (!isObject(document.paths)) document.paths = {};
  const paths = document.paths as JsonObject;
  paths[TARGETED_TESTS_PATH] = {
    post: {
      operationId: 'discoverTargetedTests',
      summary: 'Discover the smallest relevant verification commands',
      description:
        'Pins changed or target files to an exact repository snapshot, detects their nearest project manifests, finds conventional test files and returns targeted test/typecheck/lint/build commands while retaining normal CI as the final gate.',
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['repository', 'targetPaths'],
              properties: {
                repository: { type: 'string', example: 'trvny/trvny' },
                targetPaths: {
                  type: 'array',
                  minItems: 1,
                  maxItems: MAX_TARGETS,
                  items: { type: 'string' },
                  example: ['gh-apps/kanarek-companion/src/runtime-entry.ts'],
                },
                ref: { type: 'string', description: 'Optional branch, tag or exact commit SHA.' },
              },
            },
          },
        },
      },
      responses: {
        '200': objectResponse('Targeted verification discovery result'),
        '400': objectResponse('Invalid test discovery request'),
        '502': objectResponse('GitHub test discovery lookup failed'),
      },
    },
  };
}

export async function handleTargetedTestsAction(
  request: Request,
  invoke: Invoke,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== TARGETED_TESTS_PATH) return null;
  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);
  try {
    return await discoverTests(request, invoke);
  } catch (error) {
    if (error instanceof TestDiscoveryError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error(
      JSON.stringify({
        testDiscovery: 'failed',
        error: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return json({ ok: false, error: 'test_discovery_internal_error' }, 500);
  }
}
