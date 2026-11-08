// Visible "written by Claude" badge on every body the bot posts.
// Shared contract with .ai/private/claude/hooks/github-badge.py (Claude Code cloud):
// MARKER = already badged, skip; OPT_OUT = no badge, marker stripped.

export const MARKER = '<!-- claude-badge -->';
export const OPT_OUT = '<!-- no-badge -->';

// Own badge set (travnie/.github assets/badges), not shields.io.
const BADGE =
  '[![Claudiusz](https://raw.githubusercontent.com/travnie/.github/main/assets/badges/claudiusz.svg)](https://github.com/apps/claudiusz69)';

export function withBadge(body: string): string {
  // Marker only (+ its newline); authored whitespace kept.
  if (body.includes(OPT_OUT)) return body.replaceAll(`${OPT_OUT}\n`, '').replaceAll(OPT_OUT, '');
  if (body.includes(MARKER)) return body;
  return `${MARKER}\n${BADGE}\n\n${body}`;
}
