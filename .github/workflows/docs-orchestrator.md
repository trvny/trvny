---
on:
  # Bez harmonogramu swiadomie: cotygodniowa porcja PR-ow do przejrzenia to praca
  # tworzona, nie oszczedzana. Odpalac recznie, gdy jest po co.
  workflow_dispatch:

engine:
  id: copilot
  env:
    COPILOT_PROVIDER_BASE_URL: "https://api.orcarouter.ai/v1"
    COPILOT_PROVIDER_API_KEY: ${{ secrets.ORCAROUTER_API_KEY }}
    COPILOT_MODEL: deepseek/deepseek-v4-flash-free
    COPILOT_PROVIDER_TYPE: openai
    COPILOT_PROVIDER_WIRE_API: completions
model: deepseek/deepseek-v4-flash-free

models:
  providers:
    github-copilot:
      models:
        "deepseek/deepseek-v4-flash-free":
          cost:
            input: "0e0"
            output: "0e0"

network:
  allowed:
    - defaults
    - api.orcarouter.ai

permissions:
  contents: read

tools:
  github: false
  bash: false
  edit: false
  cli-proxy: false

safe-outputs:
  report-failure-as-issue: false
  dispatch-workflow:
    workflows: [docs-worker]
    max: 7
---

# Documentation Orchestrator

Dispatch `docs-worker` exactly once for each repository below, using `target_repo` exactly as written:

- `trvny/feedseek`
- `trvny/kanarek`
- `trvny/tvpi`
- `trvny/wambridge`
- `trvny/trvny`
- `trvny/Autka`
- `trvny/.ai`

Do not inspect repositories, commits, pull requests, files, or documentation here. Do not decide whether drift exists here. The worker performs that analysis independently for one repository at a time and creates no pull request when documentation is already accurate.

Use only the `dispatch-workflow` safe output. Do not modify repositories from this workflow.
