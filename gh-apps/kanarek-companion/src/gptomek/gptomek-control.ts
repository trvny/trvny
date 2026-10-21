// GPTomek control transport addresses. Issue #203 is the primary mailbox; closed
// PR #176 (+ the gptomek/control ref) is the independent fallback. See
// gh-apps/gptomek/docs/REFERENCE.md before changing any of these.
export const GPTOMEK_CONTROL_REPOSITORY = 'trvny/trvny';
export const GPTOMEK_CONTROL_ISSUE = 203;
export const GPTOMEK_CONTROL_PULL_REQUEST = 176;
export const GPTOMEK_CONTROL_BRANCH = 'gptomek/control';

export function isGptomekFallbackPullRequest(
  repository: string | null,
  number: number | null,
): boolean {
  return (
    repository === GPTOMEK_CONTROL_REPOSITORY &&
    number === GPTOMEK_CONTROL_PULL_REQUEST
  );
}
