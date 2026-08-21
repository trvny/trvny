type JsonObject = Record<string, unknown>;

const MAX_TARGET_PATHS = 6;
const MAX_CANDIDATES = 24;
const MAX_CONTENT_BYTES = 24_000;

export interface AgentScope {
  path: string;
  directory: string;
  sha: string | null;
  content: string;
  truncated: boolean;
}

export interface AgentPathGuidance {
  path: string;
  instructionPaths: string[];
}

export interface AgentGuidance {
  ref: string;
  root: string | null;
  scopes: AgentScope[];
  targets: AgentPathGuidance[];
}

export type AgentFileReader = (path: string, ref: string) => Promise<unknown | null>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validRepositoryPath(value: string): boolean {
  if (!value || value.length > 500 || value.startsWith('/') || value.endsWith('/')) return false;
  if (/\p{Cc}/u.test(value) || value.includes('\\') || value.includes('?') || value.includes('#')) {
    return false;
  }
  const segments = value.split('/');
  return segments.every(
    (segment) => segment && segment !== '.' && segment !== '..' && segment !== '.git',
  );
}

export function targetPaths(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_TARGET_PATHS) {
    throw new Error('invalid_target_paths');
  }
  const result = value.map((entry) => {
    if (typeof entry !== 'string' || !validRepositoryPath(entry)) {
      throw new Error('invalid_target_paths');
    }
    return entry;
  });
  if (new Set(result).size !== result.length) throw new Error('invalid_target_paths');
  return result;
}

function instructionCandidates(path: string): string[] {
  const parts = path.split('/');
  parts.pop();
  const result = ['AGENTS.md'];
  for (let index = 1; index <= parts.length; index += 1) {
    result.push(`${parts.slice(0, index).join('/')}/AGENTS.md`);
  }
  return result;
}

export function agentInstructionPaths(paths: string[]): string[] {
  const candidates = new Set<string>(['AGENTS.md']);
  for (const path of paths) {
    for (const candidate of instructionCandidates(path)) candidates.add(candidate);
  }
  const result = [...candidates].sort((left, right) => {
    const depth = (value: string) => value.split('/').length;
    return depth(left) - depth(right) || left.localeCompare(right);
  });
  if (result.length > MAX_CANDIDATES) throw new Error('too_many_agent_scopes');
  return result;
}

function decodeGithubFile(value: unknown): { content: string; sha: string | null; truncated: boolean } | null {
  if (!isObject(value) || value.encoding !== 'base64' || typeof value.content !== 'string') return null;
  try {
    const binary = atob(value.content.replace(/\s/g, ''));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const encoded = new TextEncoder().encode(decoded);
    const truncated = encoded.byteLength > MAX_CONTENT_BYTES;
    const content = truncated
      ? new TextDecoder().decode(encoded.slice(0, MAX_CONTENT_BYTES))
      : decoded;
    return {
      content,
      sha: typeof value.sha === 'string' ? value.sha : null,
      truncated,
    };
  } catch {
    return null;
  }
}

function directoryForAgentPath(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

function scopeApplies(scope: AgentScope, target: string): boolean {
  return !scope.directory || target === scope.directory || target.startsWith(`${scope.directory}/`);
}

export async function loadAgentGuidance(
  paths: string[],
  ref: string,
  readFile: AgentFileReader,
): Promise<AgentGuidance> {
  const candidates = agentInstructionPaths(paths);
  const loaded = await Promise.all(
    candidates.map(async (path) => {
      const raw = await readFile(path, ref);
      if (raw === null) return null;
      const file = decodeGithubFile(raw);
      if (!file) return null;
      return {
        path,
        directory: directoryForAgentPath(path),
        sha: file.sha,
        content: file.content,
        truncated: file.truncated,
      } satisfies AgentScope;
    }),
  );
  const scopes = loaded.filter((scope): scope is AgentScope => Boolean(scope));
  const root = scopes.find((scope) => scope.path === 'AGENTS.md')?.content ?? null;
  return {
    ref,
    root,
    scopes,
    targets: paths.map((path) => ({
      path,
      instructionPaths: scopes.filter((scope) => scopeApplies(scope, path)).map((scope) => scope.path),
    })),
  };
}
