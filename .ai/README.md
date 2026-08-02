# Private AI material

This directory contains provider-neutral profiles, schemas, templates, style
specifications, instruction libraries, and reference material used by `trvny`.
It is not a runtime configuration layer and nothing here becomes active merely
because the file exists.

## Active entry points

- `/AGENTS.md` is the maintained repository contract.
- `/CLAUDE.md` and `/GEMINI.md` are thin text imports of that contract.
- `/.github/copilot-instructions.md` is the Copilot-specific adapter.
- `/.github/instructions/` contains path-specific Copilot instructions.
- `/.github/agents/` and `/.claude/agents/` contain opt-in agents.
- `/.claude/settings.json` and `/.codex/config.toml` contain provider runtime
  defaults, not communication policy.

Provider adapters should refer to the shared contract instead of copying it.
Do not describe an import file as a symlink unless it is actually stored as one.

## Directory map

```text
.ai/
├── profile.yaml              primary personal style profile
├── profiles/                 additional portable profiles
├── schema/                   profile schema and documentation
├── templates/                starter files and task templates
├── styles/                   long-form style specifications
├── instructions/             paste-ready instruction libraries
└── backups/                  archival copies, never active configuration
```

The current neutral English editions are:

```text
.ai/styles/styles.md
.ai/instructions/instructions.md
```

Files with `_en.md`, `-pl.md`, or files under `backups/` are alternatives or
archives. They are not loaded automatically and must not silently become a
second source of truth.

## Profiles and templates

Validate profiles against:

```text
.ai/schema/style-profile.schema.json
```

Render a profile with:

```bash
python -m pip install pyyaml
python .ai/templates/render_profile.py .ai/profile.yaml
```

Review every template before copying it into a real project. Templates may
contain placeholders and assumptions that are intentionally incomplete.

## Maintenance rules

- Keep one maintained source of truth per concern.
- Keep generated output separate from maintained files.
- Keep provider adapters thin.
- Use absolute language only for genuine invariants.
- Treat profiles and style documents as inputs, not permissions.
- Store credentials only in environment variables or provider secret storage.
