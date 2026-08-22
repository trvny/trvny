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
          - trvny/wambridge
          - trvny/kanarek
          - trvny/Autka

run-name: Documentation worker · ${{ github.event.inputs.target_repo }}

concurrency:
  group: gh-aw-${{ github.workflow }}-${{ github.event.inputs.target_repo }}

engine: gemini
model: gemini-3.5-flash-lite

permissions:
  contents: read
  pull-requests: read

checkout:
  repository: ${{ github.event.inputs.target_repo }}
  github-token: ${{ secrets.GH_PAT }}
  current: true
  fetch-depth: 0

safe-outputs:
  github-token: ${{ secrets.GH_PAT }}
  create-pull-request:
    target-repo: ${{ github.event.inputs.target_repo }}
    title-prefix: "[docs] "
    draft: true
    max: 1
---

# Documentation Worker

Inspect the checked-out target repository for meaningful documentation drift caused by changes from the last seven days.

Read `AGENTS.md` when present and follow the repository's documentation structure, terminology, language conventions, and local style. Prefer updating existing documentation over creating parallel files. When localized counterparts describe the same behavior, keep them aligned.

Update only documentation that is demonstrably stale, such as setup steps, configuration or option descriptions, examples, commands, paths, architecture notes, workflows, or user-facing behavior that no longer matches the repository.

Keep the patch narrow. Do not modify product code, generated files, release artifacts, or changelogs unless repository instructions explicitly require it. Ignore routine dependency churn and cosmetic-only changes.

If the documentation is already accurate, make no changes and do not open a pull request. Otherwise create one concise draft pull request describing only the drift that was corrected.
