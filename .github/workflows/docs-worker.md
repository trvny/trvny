---
on:
  workflow_dispatch:
    inputs:
      target_repo:
        description: Target repository
        required: true
        type: choice
        options:
          - trvny/feedseek
          - trvny/kanarek
          - trvny/tvpi
          - trvny/wambridge
          - trvny/trvny
          - trvny/Autka
          - trvny/.ai

run-name: Documentation worker · ${{ github.event.inputs.target_repo }}

concurrency:
  group: gh-aw-${{ github.workflow }}-${{ github.event.inputs.target_repo }}

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
  pull-requests: read

checkout:
  repository: ${{ github.event.inputs.target_repo }}
  github-token: ${{ secrets.GH_PAT }}
  current: true
  fetch-depth: 0

safe-outputs:
  report-failure-as-issue: false
  github-token: ${{ secrets.GH_PAT }}
  create-pull-request:
    target-repo: ${{ github.event.inputs.target_repo }}
    title-prefix: "[docs] "
    draft: true
    max: 1
---

# Documentation Worker

Inspect the checked-out target repository for meaningful documentation drift caused by merged changes since the relevant documentation was last updated. If that point cannot be determined reliably, inspect the last thirty days instead.

Read `AGENTS.md` when present and follow the repository's documentation structure, terminology, language conventions, and local style. Prefer updating existing documentation over creating parallel files. When localized counterparts describe the same behavior, keep them aligned.

Use this documentation priority:

1. Treat `docs/**` as the primary surface when the repository has a canonical `docs` directory.
2. Update only the specific sections of `README.md` or localized README counterparts that are demonstrably stale, especially setup, configuration, usage, architecture, commands, paths, workflows, and user-facing behavior.
3. Update documentation outside `docs/**` or README only when repository conventions, links, or `AGENTS.md` make that file the canonical home for the affected information.

Do not create a `docs` directory merely because one does not exist. Do not rewrite README introductions, badges, screenshots, marketing copy, project-status prose, contribution policies, security policies, or unrelated documentation unless the merged changes directly made that material inaccurate.

Update only documentation that is demonstrably stale. Keep the patch narrow. Do not modify product code, generated files, release artifacts, or changelogs unless repository instructions explicitly require it. Ignore routine dependency churn and cosmetic-only changes.

If the documentation is already accurate, make no changes and do not open a pull request. Otherwise create one concise draft pull request describing only the drift that was corrected.
