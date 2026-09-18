export type AutomaticTaskRequest = {
  repo: string;
  goal: string;
  profile: "inspect" | "code";
};

const ACTION_RE =
  /(?:^|[\s,.;:!?])(?:sprawdź|sprawdz|przejrzyj|zaudytuj|audytuj|audyt|odpal|uruchom|napraw|popraw|dodaj|usuń|usun|zmień|zmien|zaktualizuj|implementuj|przenieś|przenies|wdroż|wdroz|refaktor(?:yzuj)?|commit|push|test(?:uj|y)?|build|fix|review|audit|inspect|run|implement|update|remove|add|change|refactor|deploy)(?=$|[\s,.;:!?])/iu;

const WRITE_RE =
  /(?:^|[\s,.;:!?])(?:napraw|popraw|dodaj|usuń|usun|zmień|zmien|zaktualizuj|implementuj|przenieś|przenies|wdroż|wdroz|refaktor(?:yzuj)?|commit|push|fix|implement|update|remove|add|change|refactor|deploy)(?=$|[\s,.;:!?])/iu;

const OWNER_REPO_RE = /\b(?:trvny|travnie)\/([A-Za-z0-9._-]{1,100})\b/giu;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\{}]/gu, "\\$&");
}

export function looksLikeAutomaticTaskCandidate(text: string): boolean {
  const trimmed = text.trim();
  return Boolean(trimmed && trimmed.length <= 20_000 && !trimmed.startsWith("/") && ACTION_RE.test(trimmed));
}

function findRepository(text: string, repositories: readonly string[]): string | null {
  const byLower = new Map(repositories.map((repo) => [repo.toLowerCase(), repo]));
  let sawOwnerRepo = false;
  for (const match of text.matchAll(OWNER_REPO_RE)) {
    sawOwnerRepo = true;
    const repo = byLower.get(match[1].toLowerCase());
    if (repo) return repo;
  }
  if (sawOwnerRepo) return null;

  for (const repo of repositories) {
    const escaped = escapeRegExp(repo);
    const pattern = new RegExp("(^|[^A-Za-z0-9._-])" + escaped + "(?=$|[^A-Za-z0-9._-])", "iu");
    if (pattern.test(text)) return repo;
  }
  return null;
}

export function automaticTaskRequest(text: string, repositories: readonly string[]): AutomaticTaskRequest | null {
  const goal = text.trim();
  if (!looksLikeAutomaticTaskCandidate(goal)) return null;
  const repo = findRepository(goal, repositories);
  if (!repo) return null;
  return { repo, goal: goal.slice(0, 20_000), profile: WRITE_RE.test(goal) ? "code" : "inspect" };
}
