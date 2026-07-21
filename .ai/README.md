# Private AI scaffold

This directory contains a small, private behavior and configuration layer for
AI tools used by `trvny`. It is not a framework and does not replace the
runtime settings of any provider.

## Source of truth

- `/AGENTS.md` is the shared repository contract.
- `/CLAUDE.md` contains only the Claude Code-specific delta.
- `/.github/copilot-instructions.md` contains only the GitHub Copilot-specific
  delta.
- `.ai/profile.yaml` is the primary personal style profile.
- `.ai/schema/style-profile.schema.json` validates portable style profiles.

Provider files should refer to the shared contract instead of copying it.

## Directory map

```text
.ai/
├── profile.yaml              primary Polish personal profile
├── profiles/                 additional portable profiles
├── schema/                   schema and schema documentation
├── templates/                small starter files and renderer
├── styles/                   long-form style specifications
├── instructions/             paste-ready instruction libraries
└── backups/                  archival copies, not active configuration
```

## Canonical documentation names

Use the neutral filenames as the current English editions:

```text
.ai/styles/styles.md
.ai/instructions/instructions.md
```

The `_en.md` files are retained as alternative earlier editions. They are not
loaded automatically and should not be treated as a second source of truth.
Polish editions use the `-pl.md` suffix.

## Profiles

Profiles describe communication behavior. They do not grant permissions or
control tools, network access, sandboxing, deployment, or secret handling.

Validate profiles against:

```text
.ai/schema/style-profile.schema.json
```

Vendor-specific metadata belongs under the `extensions` namespace so the core
profile remains portable.

## Templates

The templates are intentionally small:

- `openai-agent.py` starts with one agent and no tools,
- `render_profile.py` renders a compact instruction block,
- `wrangler.jsonc` requires project-specific values before use,
- `.dev.vars.example` contains variable names only.

Review every template before copying it into a real project. A template is a
starting line, not a deployment oracle.

## Security

Never commit real values from:

```text
.env
.dev.vars
*.pem
*.key
```

Use environment variables, provider secret storage, or a secret manager.
Example files may contain only names and inert placeholders.

## Maintenance rules

- Prefer one source of truth per concern.
- Keep generated output separate from maintained files.
- Keep provider adapters thin.
- Use tools only for access, freshness, verification, or execution.
- Add subagents only when work genuinely separates.
- Preserve raw sources separately from synthesized notes or wiki content.
