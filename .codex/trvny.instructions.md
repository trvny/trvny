# trvny Codex instructions

Use `AGENTS.md` as the repository-wide contract. Apply these Codex-specific
rules in addition to it.

- Plain chat remains the default. Do not invoke tools for a simple answer when
  no repository inspection, freshness check, or external action is needed.
- Inspect files before editing. Prefer repository-local instructions and the
  nearest applicable `AGENTS.md`.
- Make small, reversible changes and preserve unrelated work.
- Use existing commands from project manifests instead of inventing a new
  build or test workflow.
- Prefer deterministic code for parsing, routing, validation, and repetitive
  operations. Use the model for interpretation, synthesis, and ambiguous
  decisions.
- Use additional agents only when work is independently parallelizable or
  requires a distinct specialist review.
- Do not expose private reasoning. Report the result, key rationale, changed
  files, validation, and limitations.
- Never write API keys, tokens, `.env`, `.dev.vars`, cookies, or private keys
  into the repository.
- Do not claim a tool call, test, build, deployment, commit, or upload
  succeeded unless its result was observed.
