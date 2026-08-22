---
on:
  schedule: weekly on monday
  workflow_dispatch:

engine: gemini
model: gemini-3.7-flash

permissions:
  contents: read
  pull-requests: read

# The pilot set stays explicit so the agent cannot quietly widen its scope.
tools:
  github:
    github-token: ${{ secrets.GH_PAT }}
    toolsets: [repos, pull_requests]
    allowed-repos:
      - trvny/feedseek
      - trvny/wambridge
      - trvny/kanarek
      - trvny/autka
    min-integrity: merged

safe-outputs:
  dispatch-workflow:
    workflows: [docs-worker]
    max: 4
---

# Documentation Orchestrator

Review documentation drift across this pilot set only:

- `trvny/feedseek`
- `trvny/wambridge`
- `trvny/kanarek`
- `trvny/Autka`

For each repository, inspect meaningful code, configuration, workflow, and user-facing changes from the last seven days. Decide whether those changes plausibly made existing documentation stale.

Dispatch `docs-worker` once for a repository only when there is concrete evidence worth checking. Pass `target_repo` exactly as listed above. Do not dispatch for repositories with no meaningful documentation risk, routine dependency churn, formatting-only changes, generated files, or release noise.

Prefer fewer high-confidence worker runs over speculative fan-out. Do not modify target repositories from this workflow.
