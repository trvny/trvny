import type { GitHubInstallationClient } from './github-app.ts';

export type CompanionReaction = 'eyes' | 'hooray' | 'rocket';

function repoParts(repository: string): [string, string] {
  const parts = repository.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error('invalid_repository_name');
  }
  return [encodeURIComponent(parts[0]), encodeURIComponent(parts[1])];
}

export function reactionForState(state: string): CompanionReaction | null {
  if (['blocked', 'draft', 'waiting'].includes(state)) return 'eyes';
  if (state === 'ready') return 'rocket';
  if (state === 'merged') return 'hooray';
  return null;
}

export async function reactForState(
  client: GitHubInstallationClient,
  repository: string,
  pullRequestNumber: number,
  state: string,
): Promise<boolean> {
  const reaction = reactionForState(state);
  if (!reaction) return false;

  const [owner, repo] = repoParts(repository);
  try {
    await client.json<unknown>(
      `/repos/${owner}/${repo}/issues/${pullRequestNumber}/reactions`,
      'create_pull_request_reaction',
      {
        method: 'POST',
        body: JSON.stringify({ content: reaction }),
      },
    );
    return true;
  } catch (error) {
    console.warn(
      JSON.stringify({
        companionReaction: 'failed',
        pullRequestNumber,
        reaction,
        repository,
        reason: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return false;
  }
}
