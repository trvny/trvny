# Private AI scaffold

This directory contains a small, private behavior and configuration layer for
AI tools used by `trvny`. It is not a framework and does not replace the
runtime settings of any provider.

## Source of truth

- `/AGENTS.md` is the shared repository contract.
- `/CLAUDE.md` contains only the Claude Code-specific delta.
- `.ai/github/` contains the maintained GitHub-specific instructions.
- `/.github/copilot-instructions.md`, `/.github/instructions/`, and
  `/.github/agents/` contain generated discovery copies required by GitHub.
- `.ai/profile.yaml` is the primary personal style profile.
- `.ai/schema/style-profile.schema.json` validates portable style profiles.

Provider files should refer to the shared contract instead of copying it.
Generated GitHub files should be synchronized rather than edited directly.

## Directory map

```text
.ai/
├── profile.yaml              primary Polish personal profile
├── profiles/                 additional portable profiles
├── schema/                   schema and schema documentation
├── github/                   canonical GitHub instruction sources
├── tools/                    maintenance and synchronization scripts
├── templates/                small starter files and renderer
├── styles/                   long-form style specifications
├── instructions/             paste-ready instruction libraries
└── backups/                  archival copies, not active configuration
```

## GitHub instruction synchronization

GitHub discovers instructions only at designated paths under `.github/`.
Maintain their source versions under `.ai/github/`, then generate the discovery
copies with:

```bash
python .ai/tools/sync_github_instructions.py
```

Check for drift without changing files:

```bash
python .ai/tools/sync_github_instructions.py --check
```

The generated files contain a notice pointing back to their canonical source.
This arrangement avoids symlinks and provider-specific include behavior that is
not consistent across all Copilot surfaces.

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
- Run the GitHub instruction sync check after editing `.ai/github/`.
- Use tools only for access, freshness, verification, or execution.
- Add subagents only when work genuinely separates.
- Preserve raw sources separately from synthesized notes or wiki content.
