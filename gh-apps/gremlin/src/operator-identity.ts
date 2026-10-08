export const GREMLIN_GITHUB_LOGIN = 'trvny';
export const GREMLIN_GITHUB_ID = 120686325;

export function isGremlinGithubOwner(user: unknown): boolean {
  if (!user || typeof user !== 'object' || Array.isArray(user)) return false;
  const value = user as { login?: unknown; id?: unknown };
  return value.login === GREMLIN_GITHUB_LOGIN && value.id === GREMLIN_GITHUB_ID;
}
