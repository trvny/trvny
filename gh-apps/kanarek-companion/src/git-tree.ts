export type GitTreeEntry = {
  path: string;
  mode: string;
  type: string;
  sha: string;
};

export type ReadGitTree = (sha: string) => Promise<GitTreeEntry[]>;

export async function resolveGitTreeEntries(
  rootTreeSha: string,
  paths: string[],
  readTree: ReadGitTree,
): Promise<Map<string, GitTreeEntry>> {
  const cache = new Map<string, Promise<GitTreeEntry[]>>();
  const load = (sha: string): Promise<GitTreeEntry[]> => {
    let pending = cache.get(sha);
    if (!pending) {
      pending = readTree(sha);
      cache.set(sha, pending);
    }
    return pending;
  };

  const resolved = new Map<string, GitTreeEntry>();
  for (const path of paths) {
    const parts = path.split('/');
    let treeSha = rootTreeSha;
    for (let index = 0; index < parts.length; index += 1) {
      const entries = await load(treeSha);
      const entry = entries.find((candidate) => candidate.path === parts[index]);
      if (!entry) break;
      if (index === parts.length - 1) {
        resolved.set(path, { ...entry, path });
        break;
      }
      if (entry.type !== 'tree') break;
      treeSha = entry.sha;
    }
  }
  return resolved;
}
