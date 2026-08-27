---
permissions:
  contents: read

checkout:
  repository: ${{ inputs.target_repo }}
  github-token: ${{ secrets.GH_PAT }}
  current: true
  fetch-depth: 0

tools:
  github: false
  bash: false
  edit:
  cli-proxy: false

steps:
  - name: Build chunked documentation context
    shell: bash
    env:
      GH_TOKEN: ${{ secrets.GH_PAT }}
      TARGET_REPO: ${{ inputs.target_repo }}
    run: |
      set -euo pipefail

      root=/tmp/gh-aw/agent
      chunks="$root/chunks"
      mkdir -p "$chunks"
      context="$root/docs-context.md"
      changed_files=$(mktemp)
      source_files=$(mktemp)

      month_base=$(git rev-list -1 --before='30 days ago' HEAD || true)
      if [ -z "$month_base" ]; then
        month_base=$(git rev-list --max-parents=0 HEAD | tail -1)
      fi

      doc_base=$(git log -1 --format=%H -- docs ':(glob)README*.md' 2>/dev/null || true)
      base=$month_base
      if [ -n "$doc_base" ] && git merge-base --is-ancestor "$month_base" "$doc_base" 2>/dev/null; then
        base=$doc_base
      fi

      git diff --name-only "$base"..HEAD -- . > "$changed_files"
      grep -Ev '^(docs/|README[^/]*\.md$|assets/)|(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|.*\.lock\.yml)$' \
        "$changed_files" | head -12 > "$source_files" || true

      {
        echo '# Documentation drift context'
        echo
        echo "Target: $TARGET_REPO"
        echo "Head: $(git rev-parse --short=12 HEAD)"
        echo "Lookback base: $(git rev-parse --short=12 "$base")"
        echo "Commits after base: $(git rev-list --count "$base"..HEAD)"
        echo
        echo '## Root repository instructions'
        if [ -f AGENTS.md ]; then sed -n '1,60p' AGENTS.md; else echo '(no root AGENTS.md)'; fi
        echo
        echo '## Documentation candidates'
        { find docs -type f 2>/dev/null; find . -maxdepth 1 -type f -name 'README*.md' -print; } \
          | sed 's#^\./##' | sort | head -40
        echo
        echo '## Recent commits'
        git log "$base"..HEAD --first-parent --max-count=10 --date=short \
          --pretty=format:'- %h %ad %s' || true
        echo
        echo
        echo '## Changed files'
        head -50 "$changed_files"
        echo
        echo '## Open documentation pull requests'
        gh pr list --repo "$TARGET_REPO" --state open --limit 10 \
          --json number,title,headRefName \
          --jq '.[] | select(.title | startswith("[docs] ")) | "- #\(.number) \(.title) [\(.headRefName)]"' \
          || echo '(unavailable)'
      } > "$context"

      chunk=0
      in_chunk=0
      chunk_file="$chunks/chunk-0.md"
      : > "$chunk_file"
      while IFS= read -r file; do
        [ -n "$file" ] || continue
        if [ "$in_chunk" -eq 3 ]; then
          chunk=$((chunk + 1))
          in_chunk=0
          chunk_file="$chunks/chunk-$chunk.md"
          : > "$chunk_file"
        fi
        {
          echo "## $file"
          git diff --unified=1 "$base"..HEAD -- "$file" | head -90 || true
          echo
        } >> "$chunk_file"
        in_chunk=$((in_chunk + 1))
      done < "$source_files"

      if [ ! -s "$chunks/chunk-0.md" ]; then
        echo 'No relevant non-documentation changes in the bounded lookback.' > "$chunks/chunk-0.md"
      fi

safe-outputs:
  report-failure-as-issue: false
  github-token: ${{ secrets.GH_PAT }}
  create-pull-request:
    target-repo: ${{ inputs.target_repo }}
    title-prefix: "[docs] "
    draft: true
    max: 1
---

# Documentation Worker

Read `/tmp/gh-aw/agent/docs-context.md`. Treat it as the complete Git-history summary for this run and do not reconstruct or broaden Git history.

For every file matching `/tmp/gh-aw/agent/chunks/chunk-*.md`, invoke the `drift-scanner` sub-agent exactly once and give it only that chunk path. Each chunk must be analyzed in a separate sub-agent session. Use only the compact findings returned by the sub-agents for synthesis. Do not reread the chunk diffs in the parent session.

From the combined findings, inspect only documentation needed to verify concrete drift. Read at most three documentation files and only relevant sections, normally no more than about 120 lines per read. If absolutely necessary, inspect at most one additional source/config/workflow file beyond the chunk evidence. Do not reconstruct broad repository history.

Before editing a documentation path, read any nearer `AGENTS.md` that applies. Preserve the repository's existing documentation structure, terminology, language conventions, and local style. Prefer updating an existing canonical home over creating parallel documentation. Keep localized counterparts aligned when they describe the same changed behavior.

Treat `docs/**` as primary when the repository uses it. Otherwise update only specific stale sections of canonical README files or another clearly canonical documentation file. Focus on setup, configuration, usage, architecture, commands, paths, workflows, and user-facing behavior.

Ignore dependency locks, generated files, cosmetic churn, release noise, marketing prose, badges, screenshots, changelogs, policy files, and unrelated documentation. Never modify product code.

If documentation is already accurate, evidence is inconclusive, or an open documentation pull request already covers the same drift, make no changes and use `noop`. Otherwise edit only demonstrably stale documentation and create one concise draft pull request describing the corrected drift.

## agent: `drift-scanner`

---
description: Analyze one bounded diff chunk for documentation-impacting changes.
---

Read only the chunk file path supplied by the parent. Do not inspect Git history or broaden to unrelated repository files. Identify only concrete changes that could make setup, configuration, usage, architecture, commands, paths, workflows, or user-facing behavior documentation stale.

Return at most four findings. Keep the entire response under 900 characters. For each finding return: changed file, what behavior changed, and which documentation topic may now be stale. If the chunk has no credible documentation impact, return exactly `NO_DRIFT`.

## end agent: `drift-scanner`
