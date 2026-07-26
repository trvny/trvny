# Private AI templates

Small starting points for projects under the `trvny` namespace.

These files are deliberately modest. They are templates, not a new framework
wearing a hard hat.

## Contents

### `openai-agent.py`

Minimal OpenAI Agents SDK example. Start with one agent and no tools, then add
only the capabilities the workflow actually needs.

Expected environment variable:

```text
OPENAI_API_KEY
```

### `wrangler.jsonc`

Baseline Cloudflare Worker configuration. Change the Worker name and
`compatibility_date`, remove unused bindings, and keep secret values outside
the file.

### `.dev.vars.example`

Safe list of local environment-variable names:

```bash
cp .ai/templates/.dev.vars.example .dev.vars
```

Fill only the values needed by the current project. Do not commit `.dev.vars`.

### `render_profile.py`

Renders a compact instruction block from a schema 0.2 profile:

```bash
python -m pip install pyyaml
python .ai/templates/render_profile.py .ai/profile.yaml
```

Write the result to a file:

```bash
python .ai/templates/render_profile.py .ai/profile.yaml \
  --output .ai/generated/custom-instructions.pl.txt
```

The renderer separates personality from collaboration and remains compatible
with archived schema 0.1 profiles. It validates the fields it understands and
fails visibly on unsupported values.

It does not control tools, permissions, sandboxing, network access, or secrets.

### `outcome-task.md`

A compact reusable brief for complex tasks:

```text
Role
Personality
Goal
Success criteria
Constraints
Output
Stop rules
```

Use absolute words only for real invariants. For judgment calls, write a
decision rule such as “ask when ambiguity materially changes the result”
instead of forcing a ceremonial sequence of steps.

## Rules of use

- Keep secrets outside Git.
- Prefer one source of truth for configuration.
- Start with plain chat or one agent.
- Keep tool and permission policy outside style documents.
- Add tools only for access, verification, freshness, or execution.
- Add subagents only for work that genuinely separates.
- Keep generated output out of manually maintained source files.

## Suggested generated-output directory

```text
.ai/generated/
```

Generated instructions can be copied into Custom Instructions, an agent
instruction field, or another AI product. Review them before use because
product-level instructions and limits differ.
