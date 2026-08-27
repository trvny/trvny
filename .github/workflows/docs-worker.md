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
  bare: true
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

max-turns: 5

network:
  allowed:
    - defaults
    - api.orcarouter.ai

permissions:
  contents: read

checkout:
  repository: ${{ github.event.inputs.target_repo }}
  github-token: ${{ secrets.GH_PAT }}
  current: true
  fetch-depth: 0

tools:
  github: false
  bash: false
  edit:
  cli-proxy: false

steps:
  - name: Build compact documentation context
    shell: bash
    env:
      GH_TOKEN: ${{ secrets.GH_PAT }}
      TARGET_REPO: ${{ github.event.inputs.target_repo }}
    run: |
      set -euo pipefail

      mkdir -p /tmp/gh-aw
      context=/tmp/gh-aw/docs-context.md
      changed_files=$(mktemp)
      relevant_files=$(mktemp)

      month_base=$(git rev-list -1 --before='30 days ago' HEAD || true)
      if [ -z "$month_base" ]; then
        month_base=$(git rev-list --max-parents=0 HEAD | tail -1)
      fi

      doc_base=$(git log -1 --format=%H -- docs README*.md 2>/dev/null || true)
      base=${doc_base:-$month_base}

      git diff --name-only "$base"..HEAD -- . > "$changed_files"
      grep -Ev '(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.lock\.yml)$' "$changed_files" > "$relevant_files" || true

      {
        echo '# Documentation drift context'
        echo
        echo "Target: $TARGET_REPO"
        echo "Head: $(git rev-parse --short=12 HEAD)"
        echo "Lookback base: $(git rev-parse --short=12 "$base")"
        echo "Commits after base: $(git rev-list --count "$base"..HEAD)"
        echo
        echo '## Root repository instructions'
        if [ -f AGENTS.md ]; then
          sed -n '1,60p' AGENTS.md
        else
          echo '(no root AGENTS.md)'
        fi
        echo
        echo '## Documentation candidates'
        {
          find docs -type f 2>/dev/null
          find . -maxdepth 1 -type f -name 'README*.md' -print
        } | sed 's#^\./##' | sort | head -40
        echo
        echo '## Recent commits in lookback'
        git log "$base"..HEAD --first-parent --max-count=10 --date=short \
          --pretty=format:'- %h %ad %s' || true
        echo
        echo
        echo '## Changed files in lookback'
        head -40 "$relevant_files"
        echo
        echo '## Bounded source diff excerpts'
        grep -Ev '^(docs/|README[^/]*\.md$)' "$relevant_files" | head -3 | while IFS= read -r file; do
          [ -n "$file" ] || continue
          echo "### $file"
          git diff --unified=1 "$base"..HEAD -- "$file" | head -60 || true
          echo
        done
        echo
        echo '## Change size'
        git diff --shortstat "$base"..HEAD || true
        echo
        echo '## Open documentation pull requests'
        gh pr list --repo "$TARGET_REPO" --state open --limit 10 \
          --json number,title,headRefName \
          --jq '.[] | select(.title | startswith("[docs] ")) | "- #\(.number) \(.title) [\(.headRefName)]"' \
          || echo '(unavailable)'
      } > "$context"


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

Read `/tmp/gh-aw/docs-context.md` first. Treat it as the complete Git-history summary for this run. Do not reconstruct or broaden Git history.
Use the bounded commit list, changed-file list, documentation candidates, repository instructions, and open documentation pull requests from that context to decide whether merged changes made canonical documentation stale. Inspect only the files necessary to verify a concrete mismatch. The context already contains bounded source diffs. Inspect at most one source/config/workflow file beyond those excerpts and three documentation files. Read only the relevant section of each file, never more than about 100 lines at once, and do not reread material already seen. Ignore dependency locks, generated files, cosmetic churn, release noise, and unrelated prose.

Before editing a file, read any nearer `AGENTS.md` that applies to that path. Preserve the repository's documentation structure, terminology, language conventions, and local style. Prefer updating existing documentation over creating parallel files. When localized counterparts describe the same changed behavior, keep them aligned.

Treat `docs/**` as the primary documentation surface when the repository uses it. Otherwise update only specific stale sections of canonical README files or another clearly canonical documentation file. Focus on setup, configuration, usage, architecture, commands, paths, workflows, and user-facing behavior.

Do not modify product code, generated files, release artifacts, changelogs, policy files, or unrelated documentation. Keep the patch narrow.

If documentation is already accurate, the evidence is inconclusive, or an open documentation pull request already covers the same drift, make no changes and use `noop`. Otherwise edit only the stale documentation and create one concise draft pull request describing the corrected drift.
