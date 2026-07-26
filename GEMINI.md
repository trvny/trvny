AGENTS.md

@./AGENTS.md

## Gemini CLI adapter

`AGENTS.md` is the shared repository contract. This file contains only the
Gemini CLI-specific delta.

- Read `AGENTS.md` before proposing or making repository changes.
- Keep Gemini-specific settings in `.gemini/settings.json`.
- Use extensions, MCP servers, hooks, and skills only when they provide a
  concrete benefit.
- Prefer existing repository scripts and validation commands.
- Keep secrets in environment variables or a secret manager, never in Gemini
  settings, prompts, hooks, or repository files.
- For completion, follow the reporting format defined in `AGENTS.md`.
