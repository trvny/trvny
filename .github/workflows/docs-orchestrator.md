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

# gh-aw guard patterns cannot represent the dotted `.ai` repository literally.
# Keep dispatch itself constrained by the explicit seven-repository target list below.
tools:
  github:
    github-token: ${{ secrets.GH_PAT }}
    toolsets: [repos, pull_requests]
    allowed-repos:
      - trvny/*
    min-integrity: merged

safe-outputs:
  dispatch-workflow:
    workflows: [docs-worker]
    max: 7
---

# Documentation Orchestrator

Review documentation drift across this explicit target set only:

- `trvny/feedseek`
- `trvny/kanarek`
- `trvny/tvpi`
- `trvny/wambridge`
- `trvny/trvny`
- `trvny/Autka`
- `trvny/.ai`

For each repository, inspect meaningful code, configuration, workflow, and user-facing changes merged since that repository's relevant documentation was last updated. Without a schedule, runs can be any distance apart, so anchor the lookback to the documentation itself rather than to a fixed number of days; if that date cannot be determined, fall back to the last thirty days. Also inspect relevant open pull requests that may already update documentation for those changes. Decide whether merged changes plausibly made existing documentation stale and whether that drift is already being addressed.

Treat `docs/**` as the primary documentation surface when the repository uses it. README files and other canonical documentation are also in scope when merged changes plausibly stale specific setup, configuration, usage, architecture, command, path, workflow, or user-facing behavior sections. Do not dispatch merely for badges, cosmetic prose, marketing copy, dependency churn, release noise, or documentation work already in progress.

Dispatch `docs-worker` once for a repository only when there is concrete evidence worth checking and no relevant open pull request already covers the same documentation work. Pass `target_repo` exactly as listed above.

Prefer fewer high-confidence worker runs over speculative fan-out. Do not modify target repositories from this workflow.
