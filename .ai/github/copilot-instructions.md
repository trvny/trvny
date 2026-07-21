# GitHub Copilot adapter

Use `AGENTS.md` as the repository-wide source of truth. Apply the nearest
path-specific file from `.github/instructions/` when one matches the files in
scope.

This file contains only GitHub Copilot-specific guidance:

- Read `AGENTS.md` before proposing repository changes.
- Do not restate or duplicate the full repository contract in generated plans,
  comments, or pull-request descriptions.
- Respect path-specific instructions and keep their scope narrow.
- Preserve unrelated user changes and avoid mass formatting.
- Prefer existing repository scripts and validation commands.
- Do not edit, create, deploy, merge, or delete external resources unless the
  current task explicitly requests it and the operation is authorized.
- Never expose secrets, environment values, credentials, cookies, or private
  repository data in generated examples or summaries.
- For current platform behavior, use primary documentation from GitHub,
  OpenAI, Cloudflare, or Microsoft rather than relying on stale memory.

For completion, follow the reporting format defined in `AGENTS.md`.
