# Private AI templates

Small starting points for projects under the `trvny` namespace.

These files are deliberately modest. They are templates, not a new framework wearing a hard hat.

## Contents

### `openai-agent.py`

Minimal OpenAI Agents SDK example.

Use it when a task actually benefits from a model loop or tools. Start with one agent and no tools, then add only the capabilities the workflow needs.

Expected environment variable:

```text
OPENAI_API_KEY
```

### `wrangler.jsonc`

Baseline Cloudflare Worker configuration.

Before use:

- change the Worker name,
- update `compatibility_date` when creating the real project,
- remove unused bindings,
- add secrets with Wrangler or the Cloudflare dashboard, never as plaintext values in the file.

### `.dev.vars.example`

Safe list of local environment-variable names.

Copy it locally:

```bash
cp .ai/templates/.dev.vars.example .dev.vars
```

Fill only the values needed by the current project. Do not commit `.dev.vars`.

### `render_profile.py`

Renders a compact custom-instructions block from `.ai/profile.yaml` or another profile file.

The renderer requires Python 3.11+ and PyYAML:

```bash
python -m pip install pyyaml
python .ai/templates/render_profile.py .ai/profile.yaml
```

Write the result to a file:

```bash
python .ai/templates/render_profile.py .ai/profile.yaml \
  --output .ai/generated/custom-instructions.pl.txt
```

The renderer validates the small subset of profile fields it understands and fails visibly on unsupported base styles or malformed intensities. It does not control tools, permissions, sandboxing, or secrets.

## Rules of use

- Keep secrets outside Git.
- Prefer one source of truth for configuration.
- Start with plain chat or one agent.
- Add tools only for access, verification, freshness, or execution.
- Add subagents only for work that genuinely separates.
- Keep generated output out of the manually maintained source files.

## Suggested generated-output directory

```text
.ai/generated/
```

Generated instructions can be copied into ChatGPT Custom Instructions, an agent instruction field, or another AI product. Review them before use because product-level instructions and limits differ.
