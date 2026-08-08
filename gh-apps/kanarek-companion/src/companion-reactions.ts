import { repoParts } from './companion-github.ts';
import type { GitHubInstallationClient } from './github-app.ts';

export type CompanionReaction = 'eyes' | 'hooray' | 'rocket';

interface IssueReaction {
  content?: string | null;
  id?: number;
  user?: { login?: string | null; type?: string | null } | null;
}

const MANAGED_REACTIONS = new Set<CompanionReaction>(['eyes', 'rocket', 'hooray']);

export function reactionForState(state: string): CompanionReaction | null {
  if (['blocked', 'draft', 'waiting'].includes(state)) return 'eyes';
  if (state === 'ready') return 'rocket';
  if (state === 'merged') return 'hooray';
  return null;
}

export async function syncReaction(
  client: GitHubInstallationClient,
  appSlug: string,
  repository: string,
  pullRequestNumber: number,
  state: string,
): Promise<boolean> {
  const desired = reactionForState(state);
  const [owner, repo] = repoParts(repository);
  const path = `/repos/${owner}/${repo}/issues/${pullRequestNumber}/reactions`;
  const ownLogin = `${appSlug}[bot]`;

  try {
    const existing = await client.paginate<IssueReaction>(
      path,
      'list_pull_request_reactions',
    );
    const managed = existing.filter(
      (reaction) =>
        reaction.user?.login === ownLogin &&
        typeof reaction.content === 'string' &&
        MANAGED_REACTIONS.has(reaction.content as CompanionReaction),
    );
    const stale = managed.filter(
      (reaction) => reaction.content !== desired && typeof reaction.id === 'number',
    );

    await Promise.all(
      stale.map((reaction) =>
        client.void(
          `${path}/${reaction.id}`,
          'delete_pull_request_reaction',
          { method: 'DELETE' },
        ),
      ),
    );

    const hasDesired = Boolean(
      desired && managed.some((reaction) => reaction.content === desired),
    );
    if (desired && !hasDesired) {
      await client.json<unknown>(path, 'create_pull_request_reaction', {
        method: 'POST',
        body: JSON.stringify({ content: desired }),
      });
    }
    return stale.length > 0 || Boolean(desired && !hasDesired);
  } catch (error) {
    console.warn(
      JSON.stringify({
        companionReaction: 'failed',
        pullRequestNumber,
        reaction: desired,
        repository,
        reason: error instanceof Error ? error.message : 'unknown_error',
      }),
    );
    return false;
  }
}
