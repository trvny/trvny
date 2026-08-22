---
on:
  # Bez harmonogramu swiadomie: cotygodniowa porcja PR-ow do przejrzenia to praca
  # tworzona, nie oszczedzana. Odpalac recznie, gdy jest po co.
  workflow_dispatch:

engine: gemini
model: gemini-3.5-flash-lite

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

For each repository, inspect meaningful code, configuration, workflow, and user-facing changes merged since that repository's documentation was last updated. Without a schedule, runs can be any distance apart, so anchor the lookback to the documentation itself rather than to a fixed number of days; if that date cannot be determined, fall back to the last thirty days. Also inspect relevant open pull requests that may already update documentation for those changes. Decide whether merged changes plausibly made existing documentation stale and whether that drift is already being addressed.

Dispatch `docs-worker` once for a repository only when there is concrete evidence worth checking and no relevant open pull request already covers the same documentation work. Pass `target_repo` exactly as listed above. Do not dispatch for repositories with no meaningful documentation risk, routine dependency churn, formatting-only changes, generated files, release noise, or documentation work already in progress.

Prefer fewer high-confidence worker runs over speculative fan-out. Do not modify target repositories from this workflow.
