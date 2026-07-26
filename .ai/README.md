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
├── schema/                   profile schema and documentation
├── templates/                small starter files and task templates
├── styles/                   long-form style specifications
├── instructions/             paste-ready instruction libraries
└── backups/                  archival copies, not active configuration
```

## LLM style model

Schema 0.2 separates:

- `personality`: voice, tone, humor, warmth, directness, register adaptation,
  and artifact-style handling;
- `collaboration`: questions, assumptions, initiative, verification, preambles,
  progress updates, and result reporting.

Tool permissions, model selection, routing, sandboxing, approvals, retries, and
external side effects remain runtime policy. A friendly voice cannot authorize
a deployment, and a strict verification preference cannot create web access.

The schema and renderer keep read compatibility with archived 0.1 profiles.

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

Validate profiles against:

```text
.ai/schema/style-profile.schema.json
```

Vendor-specific metadata belongs under `extensions` so the core profile remains
portable.

Render a profile:

```bash
python -m pip install pyyaml
python .ai/templates/render_profile.py .ai/profile.yaml
```

## Templates

The templates are intentionally small:

- `openai-agent.py` starts with one agent and no tools,
- `render_profile.py` renders a compact communication and collaboration block,
- `outcome-task.md` provides a reusable outcome-first brief for complex tasks,
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
- Use absolute language only for genuine invariants.
- Encode judgment calls as decision rules rather than ceremonial step lists.
- Use tools only for access, freshness, verification, or execution.
- Add subagents only when work genuinely separates.
- Preserve raw sources separately from synthesized notes or wiki content.
